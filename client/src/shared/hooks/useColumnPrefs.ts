import { useMemo, useState } from 'react';

export interface ColumnMeta {
  id: string;
  label: string;
  /**
   * Always visible, never draggable — stays fixed at the position it's defined
   * in the `columns` array (e.g. a leading checkbox column or a trailing
   * actions column).
   */
  pinned?: boolean;
}

export interface ColumnPrefsColumn extends ColumnMeta {
  visible: boolean;
}

export interface ColumnPrefs {
  /** Every column in the user's current order, flagged with visibility — feeds the Filter menu. */
  all: ColumnPrefsColumn[];
  /** Visible columns only, in order — drives <th>/<td> rendering. */
  visible: ColumnMeta[];
  toggleVisible(id: string): void;
  moveColumn(id: string, toIndex: number): void;
  reset(): void;
}

interface StoredPrefs {
  /** Order of the non-pinned columns only. */
  order: string[];
  hidden: string[];
}

function loadStored(key: string): StoredPrefs | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as StoredPrefs : null;
  } catch {
    return null;
  }
}

function saveStored(key: string, prefs: StoredPrefs) {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable (private mode / quota) — preferences just won't persist
  }
}

/**
 * Persisted column order + visibility for a table, keyed by `tableId`.
 * Reconciles saved state against the current `columns` definition so adding,
 * removing, or renaming a column in code never breaks a saved layout.
 *
 * Pinned columns keep the position they're defined at in `columns` (so a
 * leading checkbox column or a trailing actions column never moves); only
 * non-pinned columns are reorderable/hideable.
 */
export function useColumnPrefs(tableId: string, columns: ColumnMeta[]): ColumnPrefs {
  const storageKey  = `table-columns:${tableId}`;
  const defaultIds  = useMemo(() => columns.map(c => c.id), [columns]);
  const pinnedIds   = useMemo(() => new Set(columns.filter(c => c.pinned).map(c => c.id)), [columns]);
  const movableIds  = useMemo(() => defaultIds.filter(id => !pinnedIds.has(id)), [defaultIds, pinnedIds]);
  const byId        = useMemo(() => new Map(columns.map(c => [c.id, c])), [columns]);

  function normalizeMovable(order: string[]): string[] {
    const valid   = order.filter(id => movableIds.includes(id));
    const missing = movableIds.filter(id => !valid.includes(id));
    return [...valid, ...missing];
  }

  const [order, setOrder]   = useState<string[]>(() => {
    const saved = loadStored(storageKey);
    return normalizeMovable(saved?.order ?? movableIds);
  });
  const [hidden, setHidden] = useState<Set<string>>(() => {
    const saved = loadStored(storageKey);
    return new Set((saved?.hidden ?? []).filter(id => movableIds.includes(id)));
  });

  /** Interleaves pinned columns back at their original index among the movable sequence. */
  function buildFullOrder(movableOrder: string[]): string[] {
    // Defensive: reconcile against the current column set on every read, so a
    // caller-supplied `columns` array that changes shape at runtime (e.g. an
    // admin-only column) never silently drops out.
    const reconciled = normalizeMovable(movableOrder);
    const result: string[] = new Array(defaultIds.length);
    defaultIds.forEach((id, idx) => { if (pinnedIds.has(id)) result[idx] = id; });
    let mi = 0;
    for (let i = 0; i < result.length; i++) {
      if (result[i] === undefined) result[i] = reconciled[mi++];
    }
    return result;
  }

  function persist(nextOrder: string[], nextHidden: Set<string>) {
    setOrder(nextOrder);
    setHidden(nextHidden);
    saveStored(storageKey, { order: nextOrder, hidden: [...nextHidden] });
  }

  function toggleVisible(id: string) {
    if (pinnedIds.has(id)) return;
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id); else next.add(id);
    persist(order, next);
  }

  function moveColumn(id: string, toFullIndex: number) {
    if (pinnedIds.has(id)) return;
    const fullOrder = buildFullOrder(order);
    const clamped   = Math.max(0, Math.min(toFullIndex, fullOrder.length - 1));
    // Convert a full-list index into an index within the movable-only sequence.
    let movableIndex = 0;
    for (let i = 0; i < clamped; i++) {
      if (!pinnedIds.has(fullOrder[i])) movableIndex++;
    }
    const without = order.filter(cid => cid !== id);
    const next    = [...without.slice(0, movableIndex), id, ...without.slice(movableIndex)];
    persist(next, hidden);
  }

  function reset() {
    persist(movableIds, new Set());
  }

  const fullOrder = buildFullOrder(order);
  const all: ColumnPrefsColumn[] = fullOrder
    .map(id => byId.get(id))
    .filter((c): c is ColumnMeta => !!c)
    .map(c => ({ ...c, visible: c.pinned ? true : !hidden.has(c.id) }));

  const visible = all.filter(c => c.visible);

  return { all, visible, toggleVisible, moveColumn, reset };
}
