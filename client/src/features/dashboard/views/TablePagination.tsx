import { Combobox } from '@/shared/components/ui';
import s from '@/styles/features/dashboard/views/views.module.css';

export interface TablePaginationPageSize {
  value:   number;
  options: readonly number[];
  onChange: (value: number) => void;
}

export interface TablePaginationProps {
  page:       number;
  totalPages: number;
  onPrev:     () => void;
  onNext:     () => void;
  /** Adds a "Show N per page" selector — omit for tables with a fixed page size. */
  pageSize?: TablePaginationPageSize;
  /** Extra class appended to the footer row (e.g. to drop the border when placed outside a card). */
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Standard "Page X of Y" + Prev/Next footer for paginated tables across the
 * dashboard (Threads, Attachments, …), with an optional page-size picker.
 * Callers own whether to render this at all (e.g. gated by a Filter-menu
 * "Pagination" show/hide toggle) — this component is just the footer itself.
 */
export function TablePagination({ page, totalPages, onPrev, onNext, pageSize, className, style }: TablePaginationProps) {
  return (
    <div className={`${s.modalFoot} ${className ?? ''}`} style={{ ...style, justifyContent: 'flex-end' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={s.muted} style={{ fontSize: 12 }}>Page {page} of {totalPages}</span>
        {pageSize && (
          <span className={s.muted} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Show
            <Combobox
              size="sm"
              dropUp
              className={s.pageSizeCombobox}
              options={pageSize.options.map(n => ({ value: String(n), label: String(n) }))}
              value={String(pageSize.value)}
              onChange={(v) => pageSize.onChange(Number(v))}
              searchable={false}
            />
            per page
          </span>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={s.btn} disabled={page <= 1}          onClick={onPrev}>‹ Prev</button>
        <button className={s.btn} disabled={page >= totalPages} onClick={onNext}>Next ›</button>
      </div>
    </div>
  );
}
