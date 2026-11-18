import { useState } from 'react';

function loadStored(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function saveStored(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // localStorage unavailable (private mode / quota) — preference just won't persist
  }
}

/**
 * Persisted show/hide state for a page's search bar, toggled from the Filter
 * menu rather than the search bar itself. Keyed by `tableId` so each page
 * remembers its own preference.
 */
export function useSearchBarVisibility(tableId: string, defaultVisible = true): [boolean, (visible: boolean) => void] {
  const storageKey = `search-bar-visible:${tableId}`;
  const [visible, setVisibleState] = useState(() => loadStored(storageKey, defaultVisible));

  function setVisible(next: boolean) {
    setVisibleState(next);
    saveStored(storageKey, next);
  }

  return [visible, setVisible];
}
