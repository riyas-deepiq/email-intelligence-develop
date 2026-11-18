// =============================================================================
// lib/persistCache.ts — persist the React Query cache across reloads
// =============================================================================
//
// React Query caches in memory, so a hard reload (F5) drops everything and each
// avatar (and every other query) refetches. This writes the cache to IndexedDB
// and restores it on startup, so a reload reuses what was already fetched.
//
// Zero external deps — uses React Query core's dehydrate/hydrate + a tiny
// IndexedDB wrapper.
//
// Privacy: the cache is cleared on logout (`auth:unauthorized`) so a signed-out
// browser holds no email data. Bump CACHE_VERSION to invalidate old snapshots.

import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

const DB_NAME = 'insight-hub-query-cache';
const STORE = 'keyval';
const KEY = 'rq-state';

const CACHE_VERSION = 'v1'; // change to drop all persisted data
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // ignore snapshots older than 24h
const WRITE_DEBOUNCE_MS = 1000; // coalesce bursts of cache writes

interface Snapshot {
  version: string;
  timestamp: number;
  state: unknown;
}

// ── minimal IndexedDB key/value ──
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(value: Snapshot): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Load a saved snapshot into the client. Call once, before rendering. */
export async function restoreCache(client: QueryClient): Promise<void> {
  try {
    const snap = await idbGet<Snapshot>();
    if (!snap) return;
    if (snap.version !== CACHE_VERSION || Date.now() - snap.timestamp > MAX_AGE_MS) {
      await idbClear();
      return;
    }
    hydrate(client, snap.state);
  } catch {
    // IndexedDB unavailable (private mode, disabled) — just skip persistence.
  }
}

/** Subscribe to cache changes and mirror them to IndexedDB (debounced). */
export function persistCache(client: QueryClient): void {
  let timer: number | undefined;

  const flush = () => {
    // Only successful queries are worth persisting; skip loading/error states.
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === 'success',
    });
    void idbSet({ version: CACHE_VERSION, timestamp: Date.now(), state }).catch(() => {});
  };

  client.getQueryCache().subscribe(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(flush, WRITE_DEBOUNCE_MS);
  });

  // Wipe persisted email data when the session ends.
  window.addEventListener('auth:unauthorized', () => {
    void idbClear().catch(() => {});
  });
}
