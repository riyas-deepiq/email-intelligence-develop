import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryAuditLog, type AuditQueryParams, type AuditLogEntry } from '@/features/audit/audit.api';
import { auditEventLabel, auditTargetLabel, auditCategoryTone, toneColorVars } from '@/features/audit/audit.labels';
import { Badge, ColumnFilterMenu, Icon, TableToolbar, UserCell } from '@/shared/components/ui';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import { useSearchBarVisibility } from '@/shared/hooks/useSearchBarVisibility';
import { matchesSearchTerm, normalizeSearchTerm } from '@/shared/utils/search';
import { TablePagination } from './TablePagination';
import s from '@/styles/features/dashboard/views/views.module.css';
import styles from '@/styles/features/dashboard/views/AuditLogView.module.css';
import { useResetOnHide } from '@/features/dashboard/viewActive';

const AUDIT_PAGE_SIZES = [25, 50, 100] as const;

const AUDIT_COLUMNS: ColumnMeta[] = [
  { id: 'who',    label: 'Who', pinned: true },
  { id: 'action', label: 'Action' },
  { id: 'target', label: 'Target' },
  { id: 'ip',     label: 'IP Address' },
  { id: 'when',   label: 'When' },
];

/**
 * What an event acted on, or null when nothing better than a raw internal ID
 * is available. For example, auth.* events key off the actor's own user id,
 * which the Who column already identifies.
 */
function targetLabel(entry: AuditLogEntry): string | null {
  if (entry.entityType === 'session') return null;
  return auditTargetLabel(entry.eventType, entry.oldValue, entry.newValue);
}

function formatAuditTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year:   'numeric',
    month:  'short',
    day:    '2-digit',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function toCsvRow(fields: (string | number)[]): string {
  return fields.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(',') + '\r\n';
}

function downloadAuditCsv(entries: AuditLogEntry[]) {
  let csv = toCsvRow(['Time', 'Name', 'Actor', 'Role', 'Event', 'Entity Type', 'Entity', 'IP Address']);
  for (const e of entries) {
    const target = targetLabel(e) ?? `${e.entityType}:${e.entityId.slice(0, 12)}`;
    csv += toCsvRow([
      new Date(e.ts).toLocaleString(),
      e.actorDisplayName ?? '',
      e.actorEmail,
      e.actorRole,
      auditEventLabel(e.eventType),
      e.entityType,
      target,
      e.ipAddress ?? '',
    ]);
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function renderAuditCell(colId: string, entry: AuditLogEntry) {
  const tone = auditCategoryTone(entry.entityType);
  const { fg } = toneColorVars(tone);
  const target = targetLabel(entry);

  switch (colId) {
    case 'who':
      return (
        <td key={colId}>
          <UserCell
            name={entry.actorDisplayName ?? entry.actorEmail}
            secondary={entry.actorEmail}
            mailboxId={entry.mailboxId ?? undefined}
            size={28}
          />
        </td>
      );
    case 'action':
      return <td key={colId}><Badge tone={tone}>{auditEventLabel(entry.eventType)}</Badge></td>;
    case 'target':
      return (
        <td key={colId}>
          {target ? (
            <span className={styles.targetText} style={{ color: fg }}>{target}</span>
          ) : (
            <span className={s.muted}>-</span>
          )}
        </td>
      );
    case 'ip':
      return <td key={colId} className={`${s.muted} ${s.fs12}`}>{entry.ipAddress ?? '-'}</td>;
    case 'when': {
      const exactTime = formatAuditTime(entry.ts);
      return (
        <td key={colId} className={`${s.muted} ${s.fs12} ${s.noWrap}`} title={exactTime}>
          {exactTime}
        </td>
      );
    }
    default:
      return null;
  }
}

export function AuditLogView() {
  const [search, setSearch]       = useState('');
  useResetOnHide(() => setSearch(''));
  const [dateOpen, setDateOpen]   = useState(false);
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft, setToDraft]     = useState('');
  const [applied, setApplied]     = useState<{ from?: string; to?: string }>({});
  const colPrefs = useColumnPrefs('audit-log', AUDIT_COLUMNS);
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('audit-log');
  const [paginationVisible, setPaginationVisible] = useSearchBarVisibility('audit-log-pagination');

  const [limit, setLimit] = useState<number>(AUDIT_PAGE_SIZES[0]);
  const [pageIdx, setPageIdx] = useState(0);
  const [stack, setStack] = useState<(string | undefined)[]>([undefined]);
  const cursor = stack[pageIdx];

  const q = normalizeSearchTerm(search);
  const filters: AuditQueryParams = {
    limit,
    from:   applied.from,
    to:     applied.to,
    cursor,
    search: q || undefined,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-log', applied, cursor, limit, q],
    queryFn:  () => queryAuditLog(filters),
  });

  const visibleRows = (data?.data ?? []).filter((entry) =>
    matchesSearchTerm([
      entry.actorEmail,
      entry.actorDisplayName,
      entry.actorRole,
      entry.eventType,
      entry.entityType,
      entry.entityId,
      auditEventLabel(entry.eventType),
      targetLabel(entry),
      entry.ipAddress,
      entry.oldValue,
      entry.newValue,
    ], q),
  );

  const resetPaging = () => { setStack([undefined]); setPageIdx(0); };

  const changeLimit = (nextLimit: number) => {
    setLimit(nextLimit);
    resetPaging();
  };

  const changeSearch = (nextSearch: string) => {
    setSearch(nextSearch);
    resetPaging();
  };

  const toggleSearchVisible = (nextVisible: boolean) => {
    setSearchVisible(nextVisible);
    if (!nextVisible) changeSearch('');
  };

  const applyDateRange = () => {
    setApplied({
      from: fromDraft || undefined,
      to:   toDraft ? `${toDraft}T23:59:59.999Z` : undefined,
    });
    resetPaging();
    setDateOpen(false);
  };

  const clearDateRange = () => {
    setFromDraft('');
    setToDraft('');
    setApplied({});
    resetPaging();
    setDateOpen(false);
  };

  const hasDateRange = !!(applied.from || applied.to);

  const total = data?.total ?? data?.data.length ?? 0;
  const totalPages = Math.max(1, data?.totalPages ?? 1);

  const goNext = () => {
    if (!data?.nextCursor || pageIdx + 1 >= totalPages) return;
    setStack((prev) => [...prev.slice(0, pageIdx + 1), data.nextCursor!]);
    setPageIdx((i) => i + 1);
  };
  const goPrev = () => setPageIdx((i) => Math.max(0, i - 1));

  return (
    <div className={s.page}>

      <TableToolbar
        className={s.tableToolbar}
        search={searchVisible ? { value: search, onChange: changeSearch, placeholder: 'Search anything...' } : undefined}
        actions={
          <ColumnFilterMenu
            prefs={colPrefs}
            searchToggle={{ visible: searchVisible, onToggleVisible: toggleSearchVisible }}
            paginationToggle={{ visible: paginationVisible, onToggleVisible: setPaginationVisible }}
          />
        }
      >
        <div className={styles.leftActions}>
          <button className={`${s.btn} ${hasDateRange ? s.btnPrimary : ''}`} onClick={() => setDateOpen((v) => !v)}>
            <Icon name="clock" size={14} /> Date range
          </button>
          <button
            className={s.btn}
            onClick={() => downloadAuditCsv(visibleRows)}
            disabled={visibleRows.length === 0}
          >
            <Icon name="download" size={14} /> Export logs
          </button>

          {dateOpen && (
            <div className={styles.dateRangePanel}>
              <div className={styles.dateField}>
                <label>From</label>
                <input type="date" value={fromDraft} onChange={(e) => setFromDraft(e.target.value)} />
              </div>
              <div className={styles.dateField}>
                <label>To</label>
                <input type="date" value={toDraft} onChange={(e) => setToDraft(e.target.value)} />
              </div>
              <div className={styles.dateRangeActions}>
                <button className={s.btn} onClick={clearDateRange}>Clear</button>
                <button className={`${s.btn} ${s.btnPrimary}`} onClick={applyDateRange}>Apply</button>
              </div>
            </div>
          )}
        </div>
      </TableToolbar>

      {isLoading && (
        <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="clock" size={20} /></div>Loading audit log...</div>
      )}
      {isError && (
        <div className={`${s.emptyState} ${s.textDanger}`}>
          <div className={s.emptyIcon}><Icon name="alert" size={20} /></div>
          Failed to load audit log.
        </div>
      )}
      {data && data.data.length === 0 && (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}><Icon name="search" size={20} /></div>
          No audit entries found for the selected filters.
        </div>
      )}
      {data && data.data.length > 0 && visibleRows.length === 0 && (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}><Icon name="search" size={20} /></div>
          No results match "{search.trim()}".
        </div>
      )}

      {visibleRows.length > 0 && (
        <div className={s.card}>
          <div className={s.tableWrap}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  {colPrefs.visible.map((col) => <th key={col.id}>{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((entry) => (
                  <tr key={entry.id} style={{ cursor: 'default' }}>
                    {colPrefs.visible.map((col) => renderAuditCell(col.id, entry))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data && total > 0 && paginationVisible && (
        <TablePagination
          page={pageIdx + 1}
          totalPages={totalPages}
          onPrev={goPrev}
          onNext={goNext}
          pageSize={{ value: limit, options: AUDIT_PAGE_SIZES, onChange: changeLimit }}
          style={{ border: 'none', padding: '12px 4px' }}
        />
      )}
    </div>
  );
}
