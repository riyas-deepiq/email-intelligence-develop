import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import type { ColumnPrefs } from '../../hooks/useColumnPrefs';
import styles from '@/styles/shared/components/ui/ColumnFilterMenu.module.css';

export interface ColumnFilterMenuSearchToggle {
  /** Whether the page's search bar is currently shown. */
  visible: boolean;
  onToggleVisible: (visible: boolean) => void;
  /** Defaults to "Search bar". */
  label?: string;
}

export interface ColumnFilterMenuPaginationToggle {
  /** Whether the page's pagination controls are currently shown. */
  visible: boolean;
  onToggleVisible: (visible: boolean) => void;
  /** Defaults to "Pagination". */
  label?: string;
}

export interface ColumnFilterMenuPagination {
  /** 1-based index of the first row on the page. */
  start: number;
  /** 1-based index of the last row on the page. */
  end: number;
  /** Total row count. Omit for cursor pagination (renders arrows only, no "of N"). */
  total?: number;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
}

export interface ColumnFilterMenuProps {
  prefs: ColumnPrefs;
  /** Adds a show/hide checkbox for the page's search bar — the search bar itself lives on the page, not in this popover. */
  searchToggle?: ColumnFilterMenuSearchToggle;
  /** Adds a show/hide checkbox for the page's own pagination controls (e.g. a footer Prev/Next bar) — those controls live on the page, not in this popover. */
  paginationToggle?: ColumnFilterMenuPaginationToggle;
  /** Adds a "start–end of total" range with prev/next controls at the bottom of the popover. */
  pagination?: ColumnFilterMenuPagination;
  className?: string;
}

/** "Filter" button + popover — show/hide the search bar, column show/hide + drag-reorder, and pagination. */
export function ColumnFilterMenu({ prefs, searchToggle, paginationToggle, pagination, className }: ColumnFilterMenuProps) {
  const [open, setOpen]     = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const hiddenCount = prefs.all.filter(c => !c.visible).length
    + (searchToggle && !searchToggle.visible ? 1 : 0)
    + (paginationToggle && !paginationToggle.visible ? 1 : 0);

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const toIndex = prefs.all.findIndex(c => c.id === targetId);
    prefs.moveColumn(dragId, toIndex);
    setDragId(null);
  }

  return (
    <div className={`${styles.wrap} ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        className={`${styles.trigger} ${hiddenCount > 0 ? styles.triggerActive : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="filter" size={13} />
        Filter
        {hiddenCount > 0 && <span className={styles.badge}>{hiddenCount}</span>}
      </button>

      {open && (
        <div className={styles.panel} role="menu">
          {(searchToggle || paginationToggle) && (
            <>
              <ul className={styles.list}>
                {searchToggle && (
                  <li className={styles.item}>
                    <span className={styles.handle} aria-hidden />
                    <label className={styles.itemLabel}>
                      <input
                        type="checkbox"
                        checked={searchToggle.visible}
                        onChange={() => searchToggle.onToggleVisible(!searchToggle.visible)}
                      />
                      {searchToggle.label ?? 'Search bar'}
                    </label>
                  </li>
                )}
                {paginationToggle && (
                  <li className={styles.item}>
                    <span className={styles.handle} aria-hidden />
                    <label className={styles.itemLabel}>
                      <input
                        type="checkbox"
                        checked={paginationToggle.visible}
                        onChange={() => paginationToggle.onToggleVisible(!paginationToggle.visible)}
                      />
                      {paginationToggle.label ?? 'Pagination'}
                    </label>
                  </li>
                )}
              </ul>
              <div className={styles.divider} />
            </>
          )}

          <div className={styles.panelHead}>
            <span>Columns</span>
            <button type="button" className={styles.resetBtn} onClick={prefs.reset}>
              Reset
            </button>
          </div>
          <p className={styles.hint}>Drag to reorder · check to show/hide</p>
          <ul className={styles.list}>
            {prefs.all.map(col => (
              <li
                key={col.id}
                className={`${styles.item} ${col.pinned ? styles.itemPinned : ''} ${dragId === col.id ? styles.dragging : ''}`}
                draggable={!col.pinned}
                onDragStart={() => setDragId(col.id)}
                onDragOver={(e) => { if (!col.pinned) e.preventDefault(); }}
                onDrop={() => handleDrop(col.id)}
                onDragEnd={() => setDragId(null)}
              >
                <span className={styles.handle} aria-hidden>{col.pinned ? '' : '⠿'}</span>
                <label className={styles.itemLabel}>
                  <input
                    type="checkbox"
                    checked={col.visible}
                    disabled={col.pinned}
                    onChange={() => prefs.toggleVisible(col.id)}
                  />
                  {col.label}
                </label>
              </li>
            ))}
          </ul>

          {pagination && (
            <>
              <div className={styles.divider} />
              <div className={styles.paginationRow}>
                <span className={styles.paginationRange}>
                  {pagination.start.toLocaleString()}–{pagination.end.toLocaleString()}
                  {pagination.total != null && <> of {pagination.total.toLocaleString()}</>}
                </span>
                <div className={styles.paginationBtns}>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    onClick={pagination.onPrev}
                    disabled={!pagination.canPrev}
                    aria-label="Previous page"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    className={styles.pageBtn}
                    onClick={pagination.onNext}
                    disabled={!pagination.canNext}
                    aria-label="Next page"
                  >
                    ›
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
