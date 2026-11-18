import React from 'react';
import { SearchField } from './SearchField';
import IcChevronDown from '@/assets/icons/chevron-down.svg?react';
import IcChevronLeft from '@/assets/icons/chevron-left.svg?react';
import IcChevronRight from '@/assets/icons/chevron-right.svg?react';
import styles from '@/styles/shared/components/ui/TableToolbar.module.css';

export interface TableToolbarSelection {
  /** All (filtered) rows are selected. */
  allChecked: boolean;
  /** Some — but not all — rows are selected. */
  someChecked: boolean;
  /** Toggle-all when the checkbox itself is clicked. */
  onToggle: () => void;
  /** Menu action: select every row. */
  onSelectAll: () => void;
  /** Menu action: clear the selection. */
  onSelectNone: () => void;
  /** Number of selected rows (shown next to the control when > 0). */
  selectedCount?: number;
  /** Show the All/None dropdown next to the select-all checkbox. Default true. */
  showMenu?: boolean;
}

export interface TableToolbarPagination {
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

export interface TableToolbarSearch {
  value: string;
  onChange: (value: string) => void;
  /** Custom clear handler — debounced views pass one that resets both the
   *  immediate and debounced state so results clear instantly. */
  onClear?: () => void;
  placeholder?: string;
}

export interface TableToolbarProps {
  /** Left cluster: Gmail-style select-all checkbox + All/None dropdown. */
  selection?: TableToolbarSelection;
  /** Left cluster: integrated search field (grows to fill the bar). */
  search?: TableToolbarSearch;
  /** Right cluster: content placed immediately before the search field. */
  beforeSearch?: React.ReactNode;
  /** Right cluster: action buttons (e.g. "Enable all"), placed before the pager. */
  actions?: React.ReactNode;
  /** Right cluster: "start–end of total" range with prev/next chevrons. */
  pagination?: TableToolbarPagination;
  /** Extra left-aligned content, placed after the search field. */
  children?: React.ReactNode;
  /** Drops the bottom divider — use when the toolbar sits above a separate
   *  bordered card rather than directly on top of the table. */
  borderless?: boolean;
  className?: string;
}

function SelectCluster({ selection }: { selection: TableToolbarSelection }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const checkboxRef = React.useRef<HTMLInputElement>(null);
  const showMenu = selection.showMenu ?? true;

  React.useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = selection.someChecked && !selection.allChecked;
  }, [selection.someChecked, selection.allChecked]);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div className={styles.selectCluster} ref={ref}>
      <input
        ref={checkboxRef}
        type="checkbox"
        className={styles.check}
        checked={selection.allChecked}
        onChange={selection.onToggle}
        aria-label="Select all rows"
      />
      {showMenu && (
        <button
          type="button"
          className={`${styles.caretBtn} ${open ? styles.caretOpen : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Selection options"
        >
          <IcChevronDown width={10} height={10} />
        </button>
      )}

      {showMenu && open && (
        <div className={styles.menu} role="menu">
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { selection.onSelectAll(); setOpen(false); }}>
            All
          </button>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={() => { selection.onSelectNone(); setOpen(false); }}>
            None
          </button>
        </div>
      )}

      {selection.selectedCount ? (
        <span className={styles.selectedCount}>{selection.selectedCount} selected</span>
      ) : null}
    </div>
  );
}

function ToolbarSearch({ search }: { search: TableToolbarSearch }) {
  return (
    <SearchField
      value={search.value}
      onChange={search.onChange}
      onClear={search.onClear}
      placeholder={search.placeholder ?? 'Search…'}
    />
  );
}

function PaginationCluster({ pagination: p }: { pagination: TableToolbarPagination }) {
  return (
    <div className={styles.pagination}>
      <span className={styles.range}>
        {p.start.toLocaleString()}–{p.end.toLocaleString()}
        {p.total != null && <> of {p.total.toLocaleString()}</>}
      </span>
      <button type="button" className={styles.pageBtn} onClick={p.onPrev} disabled={!p.canPrev} aria-label="Previous page">
        <IcChevronLeft width={16} height={16} />
      </button>
      <button type="button" className={styles.pageBtn} onClick={p.onNext} disabled={!p.canNext} aria-label="Next page">
        <IcChevronRight width={16} height={16} />
      </button>
    </div>
  );
}

export function TableToolbar({ selection, search, beforeSearch, actions, pagination, children, borderless, className }: TableToolbarProps) {
  return (
    <div className={`${styles.bar} ${borderless ? styles.borderless : ''} ${className ?? ''}`}>
      <div className={styles.left}>
        {selection && <SelectCluster selection={selection} />}
        {children}
      </div>
      <div className={styles.right}>
        {beforeSearch}
        {search && <ToolbarSearch search={search} />}
        {actions}
        {pagination && <PaginationCluster pagination={pagination} />}
      </div>
    </div>
  );
}
