import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listMailboxes, deleteMailbox, updateMailboxSyncConfig, triggerProbe, cancelProbe, getProbeStatus,
  type Mailbox,
} from '@/features/mailboxes/mailboxes.api';
import { resyncMailboxes } from '@/features/provider-connection/provider-connection.api';
import {
  getSyncStatus, getSyncSchedule, updateSyncSchedule, startSync, pauseSync,
  type SyncSchedule,
} from '@/features/sync/sync.api';
import { useToast } from '@/shared/toast/useToast';
import {
  Label, TableToolbar, UserCell, ColumnFilterMenu, Button, AsyncState, Combobox, Icon,
  type LabelVariant,
} from '@/shared/components/ui';
import { Drawer } from '@/shared/components/Drawer';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import { useSearchBarVisibility } from '@/shared/hooks/useSearchBarVisibility';
import { matchesSearchTerm, normalizeSearchTerm } from '@/shared/utils/search';
import { TablePagination } from './TablePagination';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';
import type { ReactNode } from 'react';
import { useResetOnHide } from '@/features/dashboard/viewActive';

// ─── Table columns (show/hide + reorder via the Filter menu) ─────────────────

const MAILBOX_COLUMNS: ColumnMeta[] = [
  { id: 'user',       label: 'User' },
  { id: 'department', label: 'Department' },
  { id: 'probe',       label: 'Mailbox scan' },
  { id: 'sync',        label: 'Sync' },
  { id: 'messages',    label: 'Messages' },
  { id: 'lastSync',    label: 'Last Sync' },
];

const MAILBOX_PAGE_SIZES = [25, 50, 100] as const;

function renderMailboxCell(colId: string, m: Mailbox) {
  switch (colId) {
    case 'user':
      return (
        <td key={colId}>
          <UserCell
            mailboxId={m.id}
            name={m.displayName ?? m.address}
            secondary={m.jobTitle ? `${m.jobTitle} · ${m.address}` : m.address}
            size={32}
            fallbackBg={m.provider === 'm365' ? '#0078d4' : '#4285f4'}
          />
        </td>
      );
    case 'department':
      return <td key={colId} className={styles.tdMuted}>{m.departmentName ?? '—'}</td>;
    case 'probe':
      return (
        <td key={colId}>
          <ProbeStatusBadge status={m.probeStatus} />
          {m.probeStatus === 'complete' && (m.emailCountEstimate != null || m.earliestEmailAt) && (
            <div style={{ fontSize: 11, color: 'var(--d-text-dim, #94a3b8)', marginTop: 4, whiteSpace: 'nowrap' }}>
              {m.emailCountEstimate != null && `~${m.emailCountEstimate.toLocaleString()} emails`}
              {m.emailCountEstimate != null && m.earliestEmailAt && ' '}
              {m.earliestEmailAt && `from ${new Date(m.earliestEmailAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
            </div>
          )}
        </td>
      );
    case 'sync': {
      const noMailInRange = m.syncStatus === 'complete' && m.totalMessages === 0 && (m.emailCountEstimate ?? 0) > 0;
      return (
        <td key={colId}>
          <SyncStatusBadge status={m.syncStatus} />
          {noMailInRange && (
            <div style={{ fontSize: 11, color: 'var(--d-text-dim, #94a3b8)', marginTop: 4, whiteSpace: 'nowrap' }} title="This mailbox has mail, but none of it falls inside the configured sync range.">
              No mail in sync range
            </div>
          )}
        </td>
      );
    }
    case 'messages':
      return (
        <td key={colId} className={`${styles.tdMuted} ${styles.tdNoWrap}`}>
          {m.syncedMessages.toLocaleString()} / {m.totalMessages.toLocaleString()}
        </td>
      );
    case 'lastSync':
      return (
        <td key={colId} className={`${styles.tdMuted} ${styles.tdNoWrap}`}>
          {m.lastSyncAt
            ? new Date(m.lastSyncAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '—'}
        </td>
      );
    default:
      return null;
  }
}

// ─── Status badge helpers ─────────────────────────────────────────────────────

const SYNC_VARIANT: Record<string, LabelVariant> = {
  not_started: 'neutral',
  syncing:     'info',
  complete:    'ok',
  error:       'down',
};

const PROBE_VARIANT: Record<string, LabelVariant> = {
  not_started: 'neutral',
  pending:     'warn',
  running:     'info',
  complete:    'ok',
  error:       'down',
};

const PROBE_LABEL: Record<string, string> = {
  not_started: 'Not started',
  pending:     'Pending',
  running:     'Running',
  complete:    'Completed',
  error:       'Error',
};

function SyncStatusBadge({ status }: { status: string }) {
  return (
    <Label variant={SYNC_VARIANT[status] ?? 'neutral'} size="sm">
      {status.replace('_', ' ')}
    </Label>
  );
}

function ProbeStatusBadge({ status }: { status: string }) {
  return (
    <Label variant={PROBE_VARIANT[status] ?? 'neutral'} size="sm">
      {PROBE_LABEL[status] ?? status}
    </Label>
  );
}

// ─── Schedule field card ────────────────────────────────────────────────────────

function ScheduleField({ label, icon, children }: { label: string; icon: string; children: ReactNode }) {
  return (
    <div className={styles.scheduleCard}>
      <div className={styles.scheduleCardIcon}>
        <Icon name={icon} size={14} />
      </div>
      <div className={styles.scheduleCardBody}>
        <div className={styles.scheduleCardLabel}>{label}</div>
        {children}
      </div>
    </div>
  );
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

interface DrawerProps {
  mailbox: Mailbox;
  onClose: () => void;
}

function MailboxDrawer({ mailbox, onClose }: DrawerProps) {
  const toast = useToast();
  const qc    = useQueryClient();

  const [syncEnabled,  setSyncEnabled]  = useState(mailbox.syncEnabled);
  const [syncFromDate, setSyncFromDate] = useState(mailbox.syncFromDate?.slice(0, 10) ?? '');
  const [syncPriority, setSyncPriority] = useState(mailbox.syncPriority);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const updateMut = useMutation({
    mutationFn: () => updateMailboxSyncConfig(mailbox.id, {
      syncEnabled,
      syncPriority,
      syncFromDate: syncFromDate || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success('Sync configuration saved.');
    },
    onError: () => toast.error('Failed to save sync config.'),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteMailbox(mailbox.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success('Mailbox removed.');
      onClose();
    },
    onError: () => toast.error('Failed to remove mailbox.'),
  });

  const isDirty =
    syncEnabled !== mailbox.syncEnabled ||
    (syncFromDate || null) !== (mailbox.syncFromDate?.slice(0, 10) || null) ||
    syncPriority !== mailbox.syncPriority;

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';

  return (
    <Drawer
      onClose={onClose}
      title={mailbox.address}
      subtitle={mailbox.provider === 'm365' ? 'Microsoft 365' : 'Google Workspace'}
    >
      {/* Stats */}
      <section>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-lo, #6b7280)', marginBottom: 10 }}>Stats</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Scan', value: <ProbeStatusBadge status={mailbox.probeStatus} /> },
            { label: 'Sync', value: <SyncStatusBadge status={mailbox.syncStatus} /> },
            { label: 'Total messages', value: mailbox.totalMessages.toLocaleString() },
            { label: 'Synced', value: mailbox.syncedMessages.toLocaleString() },
            { label: 'Earliest email', value: fmt(mailbox.earliestEmailAt) },
            { label: 'Last sync', value: fmt(mailbox.lastSyncAt) },
            { label: 'Est. count', value: mailbox.emailCountEstimate != null ? mailbox.emailCountEstimate.toLocaleString() : '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--surface-gray, #f9fafb)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-lo, #6b7280)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-hi, #111)' }}>{value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Sync config */}
      <section>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-lo, #6b7280)', marginBottom: 10 }}>Sync Configuration</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-md, #374151)' }}>Sync enabled</div>
              <div style={{ fontSize: 12, color: 'var(--text-lo, #6b7280)' }}>Include this mailbox in sync runs</div>
            </div>
            <button
              role="switch"
              aria-checked={syncEnabled}
              className={`${styles.toggle} ${syncEnabled ? styles.toggleOn : ''}`}
              onClick={() => setSyncEnabled((v) => !v)}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-md, #374151)', marginBottom: 6 }}>
              Sync from date
            </label>
            <input
              type="date"
              value={syncFromDate}
              onChange={(e) => setSyncFromDate(e.target.value)}
              className={styles.formInput}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-lo, #6b7280)', marginTop: 4 }}>Leave blank to sync all available history</div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--text-md, #374151)', marginBottom: 6 }}>
              Sync priority
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={syncPriority}
              onChange={(e) => setSyncPriority(Number(e.target.value))}
              className={styles.formInput}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-lo, #6b7280)', marginTop: 4 }}>Higher numbers sync first (0 = default)</div>
          </div>

          {isDirty && (
            <Button loading={updateMut.isPending} onClick={() => updateMut.mutate()}>
              {updateMut.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          )}
        </div>
      </section>

      {/* Danger zone */}
      <section style={{ borderTop: '1px solid var(--border, #e5e7eb)', paddingTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-danger, #dc2626)', marginBottom: 10 }}>Danger Zone</div>
        {confirmDelete ? (
          <div>
            <p style={{ fontSize: 13, color: 'var(--text-md, #374151)', marginBottom: 10 }}>
              This will permanently remove the mailbox. Are you sure?
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <Button variant="danger" loading={deleteMut.isPending} onClick={() => deleteMut.mutate()} fullWidth>
                {deleteMut.isPending ? 'Removing…' : 'Yes, remove'}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(false)} fullWidth>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" fullWidth onClick={() => setConfirmDelete(true)}>
            Remove mailbox
          </Button>
        )}
      </section>
    </Drawer>
  );
}

// ─── View ─────────────────────────────────────────────────────────────────────

export function MailboxesView() {
  const toast = useToast();
  const qc    = useQueryClient();
  const [selected,    setSelected]    = useState<Mailbox | null>(null);
  const [checkedIds,  setCheckedIds]  = useState<Set<string>>(new Set());
  const [query,       setQuery]       = useState('');
  const [page,        setPage]        = useState(1);
  // Shell keeps this view mounted while hidden — clear the filter and page
  // on the way out so returning gives a clean list.
  useResetOnHide(() => { setQuery(''); setPage(1); });
  const [limit,       setLimit]       = useState<number>(MAILBOX_PAGE_SIZES[0]);
  const colPrefs = useColumnPrefs('mailboxes', MAILBOX_COLUMNS);
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('mailboxes');
  const [paginationVisible, setPaginationVisible] = useSearchBarVisibility('mailboxes-pagination');

  function toggleSearchVisible(next: boolean) {
    setSearchVisible(next);
    if (!next) setQuery('');
  }

  function changeLimit(nextLimit: number) {
    setLimit(nextLimit);
    setPage(1);
  }

  const { data: probeStatus } = useQuery({
    queryKey: ['probe-status'],
    queryFn:  getProbeStatus,
  });

  const { data: syncStatus } = useQuery({
    queryKey: ['sync-status'],
    queryFn:  getSyncStatus,
  });

  const isSyncing = syncStatus?.overall === 'syncing';

  const { data: mailboxes, isLoading, isError } = useQuery({
    queryKey: ['mailboxes'],
    queryFn:  () => listMailboxes(),
  });

  const probeMut = useMutation({
    mutationFn: (ids?: string[]) => triggerProbe(ids),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      qc.invalidateQueries({ queryKey: ['probe-status'] });
      toast.success(`Scan queued for ${r.queued} mailbox(es).`);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to trigger scan.';
      toast.error(msg);
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const cancelProbeMut = useMutation({
    mutationFn: cancelProbe,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      qc.invalidateQueries({ queryKey: ['probe-status'] });
      toast.success(typeof r.message === 'string' ? r.message.replace(/\bprobe\b/gi, 'scan') : r.message);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to cancel scan.';
      toast.error(msg);
    },
  });

  const resyncMut = useMutation({
    mutationFn: (ids?: string[]) => resyncMailboxes(ids),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      if (r.errors.length > 0) {
        toast.error(`Re-sync completed with errors: ${r.errors.join('; ')}`);
        qc.invalidateQueries({ queryKey: ['alerts'] });
      } else {
        toast.success(`Re-sync complete — ${r.updated} updated, ${r.created} new mailbox(es) added.`);
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Re-sync failed.';
      toast.error(msg);
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const startMut = useMutation({
    mutationFn: (ids?: string[]) => startSync(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success('Sync started. The collector will begin on its next scheduled run.');
    },
    onError: (err: unknown) => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to start sync.';
      toast.error(msg);
    },
  });

  const pauseMut = useMutation({
    mutationFn: pauseSync,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['sync-status'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success(r.message);
    },
    onError: () => toast.error('Failed to cancel sync.'),
  });

  // ── Schedule state ────────────────────────────────────────────────────────────

  const { data: schedule } = useQuery({
    queryKey: ['sync-schedule'],
    queryFn:  getSyncSchedule,
  });

  const [scheduleEdit, setScheduleEdit] = useState<Partial<SyncSchedule> | null>(null);

  const scheduleMut = useMutation({
    mutationFn: (patch: Partial<SyncSchedule>) => updateSyncSchedule(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sync-schedule'] });
      toast.success('Schedule auto-saved.');
    },
    onError: () => toast.error('Failed to auto-save schedule.'),
  });

  // Optimistic local value merged over the last-fetched schedule + persisted
  // immediately on every change — no separate "Save" step.
  const updateScheduleField = (patch: Partial<SyncSchedule>) => {
    setScheduleEdit((p) => ({ ...p, ...patch }));
    scheduleMut.mutate(patch);
  };

  const sch = { ...(schedule ?? {}), ...(scheduleEdit ?? {}) } as SyncSchedule;

  const q = normalizeSearchTerm(query);
  const filteredMailboxes = (mailboxes ?? []).filter((m) => {
    return matchesSearchTerm([m.displayName, m.address, m.departmentName, m.jobTitle], q);
  }).sort((a, b) => {
    const aName = (a.displayName ?? a.address).trim();
    const bName = (b.displayName ?? b.address).trim();
    return aName.localeCompare(bName, undefined, { sensitivity: 'base' })
      || a.address.localeCompare(b.address, undefined, { sensitivity: 'base' });
  });

  useEffect(() => { setPage(1); }, [query]);

  const totalRows = filteredMailboxes.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / limit));
  const currentPage = Math.min(page, totalPages);
  const pagedMailboxes = filteredMailboxes.slice((currentPage - 1) * limit, currentPage * limit);

  const allIds        = filteredMailboxes.map((m) => m.id);
  const isAllChecked  = allIds.length > 0 && allIds.every((id) => checkedIds.has(id));
  const isSomeChecked = !isAllChecked && allIds.some((id) => checkedIds.has(id));

  const selectAllRows = () =>
    setCheckedIds((prev) => { const next = new Set(prev); allIds.forEach((id) => next.add(id)); return next; });
  const selectNoRows  = () =>
    setCheckedIds((prev) => { const next = new Set(prev); allIds.forEach((id) => next.delete(id)); return next; });
  const toggleAll     = () => (isAllChecked ? selectNoRows() : selectAllRows());

  const toggleOne = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const scopeIsSelection = checkedIds.size > 0;

  const handleProbeClick = () => {
    probeMut.mutate(scopeIsSelection ? Array.from(checkedIds) : undefined);
  };

  const enabledCount = mailboxes?.filter((m) => m.syncEnabled).length ?? 0;
  const totalEmails  = mailboxes?.reduce((s, m) => s + (m.emailCountEstimate ?? 0), 0) ?? 0;

  const isProbingActive = !!probeStatus && probeStatus.pending > 0;
  const probePct = probeStatus && probeStatus.total > 0 ? Math.round((probeStatus.probed / probeStatus.total) * 100) : 0;

  const activeSyncMailboxes = syncStatus?.mailboxes.filter((m) => m.syncStatus === 'syncing') ?? [];
  const syncTotal  = activeSyncMailboxes.reduce((s, m) => s + m.totalMessages, 0);
  const syncSynced = activeSyncMailboxes.reduce((s, m) => s + m.syncedMessages, 0);
  const syncPct    = syncTotal > 0 ? Math.round((syncSynced / syncTotal) * 100) : 0;

  return (
    <div className={styles.adminPage} style={{ marginTop: -16, gap: 12 }}>

      {/* Sync configuration */}
      <section className={styles.adminSection}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div className={styles.scheduleReveal} style={{ flexWrap: 'wrap' }}>
            <ScheduleField label="Initial sync range" icon="clock">
              <Combobox
                size="sm"
                searchable={false}
                value={sch.initialSyncDays == null ? 'all' : String(sch.initialSyncDays)}
                onChange={(v) => updateScheduleField({ initialSyncDays: v === 'all' ? null : Number(v) })}
                options={[
                  { value: '30',  label: '30 days' },
                  { value: '90',  label: '3 months' },
                  { value: '180', label: '6 months' },
                  { value: '365', label: '1 year' },
                  { value: 'all', label: 'All time' },
                ]}
              />
            </ScheduleField>

            <ScheduleField label="Business hours interval" icon="activity">
              <Combobox
                size="sm"
                searchable={false}
                value={String(sch.businessHoursIntervalMin ?? 5)}
                onChange={(v) => updateScheduleField({ businessHoursIntervalMin: Number(v) })}
                options={[
                  { value: '5',  label: 'Every 5 min' },
                  { value: '15', label: 'Every 15 min' },
                  { value: '30', label: 'Every 30 min' },
                  { value: '60', label: 'Every hour' },
                ]}
              />
            </ScheduleField>

            <ScheduleField label="Off-hours interval" icon="gauge">
              <Combobox
                size="sm"
                searchable={false}
                value={String(sch.offHoursIntervalMin ?? 60)}
                onChange={(v) => updateScheduleField({ offHoursIntervalMin: Number(v) })}
                options={[
                  { value: '60',   label: 'Every hour' },
                  { value: '240',  label: 'Every 4 hours' },
                  { value: '480',  label: 'Every 8 hours' },
                  { value: '1440', label: 'Once daily' },
                ]}
              />
            </ScheduleField>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {isSyncing ? (
            <button
              className={styles.settingsDangerBtn}
              style={{
                height: 32,
                boxSizing: 'border-box',
                padding: '0 14px',
                fontSize: 13,
                position: 'relative',
                background: syncTotal > 0
                  ? `linear-gradient(to right, color-mix(in srgb, var(--color-danger, #dc2626) 22%, var(--color-danger-bg, #fef2f2)) ${syncPct}%, var(--color-danger-bg, #fef2f2) ${syncPct}%)`
                  : undefined,
                transition: 'background 0.4s ease',
              }}
              onClick={() => pauseMut.mutate()}
              disabled={pauseMut.isPending}
            >
              {pauseMut.isPending ? 'Cancelling…' : 'Cancel sync'}
            </button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => startMut.mutate(scopeIsSelection ? Array.from(checkedIds) : undefined)}
              disabled={startMut.isPending || enabledCount === 0}
              style={{
                height: 32,
                boxSizing: 'border-box',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {startMut.isPending && <span className={styles.progressIndeterminate} style={{ opacity: 0.5 }} />}
              <span style={{ position: 'relative', zIndex: 1 }}>
                {startMut.isPending ? 'Starting…' : scopeIsSelection ? `Start sync (${checkedIds.size})` : '▶ Start sync'}
              </span>
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={isProbingActive ? () => cancelProbeMut.mutate() : handleProbeClick}
            disabled={probeMut.isPending || resyncMut.isPending || cancelProbeMut.isPending}
            style={{
              height: 32,
              boxSizing: 'border-box',
              ...(isProbingActive ? {
                position: 'relative',
                background: `linear-gradient(to right, color-mix(in srgb, var(--brand) 20%, transparent) ${probePct}%, transparent ${probePct}%)`,
                transition: 'background 0.4s ease',
              } : {}),
            }}
          >
            {cancelProbeMut.isPending
              ? 'Cancelling…'
              : isProbingActive
                ? `Cancel scan… ${probeStatus?.probed}/${probeStatus?.total}`
                : probeMut.isPending ? 'Queuing…' : scopeIsSelection ? `Start scan (${checkedIds.size})` : 'Re-scan all'}
          </Button>
          <button
            className={styles.settingsSaveBtn}
            style={{ height: 32, boxSizing: 'border-box', padding: '0 16px', fontSize: 13, margin: 0, opacity: resyncMut.isPending || probeMut.isPending ? 0.5 : 1 }}
            onClick={() => resyncMut.mutate(undefined)}
            disabled={resyncMut.isPending || probeMut.isPending}
            title="Pull new mailboxes and update display names, titles, departments and profile photos from the provider directory"
          >
            {resyncMut.isPending ? 'Syncing…' : '↻ Re-sync mailboxes'}
          </button>
          </div>
        </div>
      </section>

      {/* Connected mailboxes */}
      <section className={styles.adminSection}>
        {mailboxes && mailboxes.length > 0 && (
          <TableToolbar
            selection={{
              allChecked: isAllChecked,
              someChecked: isSomeChecked,
              onToggle: toggleAll,
              onSelectAll: selectAllRows,
              onSelectNone: selectNoRows,
              selectedCount: checkedIds.size,
              showMenu: false,
            }}
            search={searchVisible ? { value: query, onChange: setQuery, placeholder: 'Search by name, email, or department…' } : undefined}
            beforeSearch={
              <>
                <span className={styles.adminCount} style={{ whiteSpace: 'nowrap' }}>
                  {q ? `${filteredMailboxes.length} of ${mailboxes.length}` : mailboxes.length} mailbox{mailboxes.length !== 1 ? 'es' : ''}
                </span>
                {totalEmails > 0 && (
                  <span className={styles.adminCount} style={{ whiteSpace: 'nowrap' }}>~{totalEmails.toLocaleString()} emails</span>
                )}
              </>
            }
            actions={
              <ColumnFilterMenu
                prefs={colPrefs}
                searchToggle={{ visible: searchVisible, onToggleVisible: toggleSearchVisible }}
                paginationToggle={{ visible: paginationVisible, onToggleVisible: setPaginationVisible }}
              />
            }
          />
        )}

        {isLoading && <AsyncState variant="loading">Loading mailboxes…</AsyncState>}
        {isError && <AsyncState variant="error">Failed to load mailboxes.</AsyncState>}
        {mailboxes && mailboxes.length === 0 && (
          <AsyncState>No mailboxes connected yet. Go to Settings → Email Provider to connect.</AsyncState>
        )}
        {mailboxes && mailboxes.length > 0 && filteredMailboxes.length === 0 && (
          <AsyncState>No mailboxes match "{query.trim()}".</AsyncState>
        )}
        {filteredMailboxes.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: 36, paddingLeft: 14 }} />
                  {colPrefs.visible.map((col) => <th key={col.id}>{col.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {pagedMailboxes.map((m) => (
                  <tr
                    key={m.id}
                    onClick={() => setSelected(m)}
                    style={{ cursor: 'pointer', background: checkedIds.has(m.id) ? 'var(--d-surface-active)' : undefined }}
                    className={styles.tableRowHover}
                  >
                    <td style={{ paddingLeft: 14 }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(m.id)}
                        onChange={() => toggleOne(m.id)}
                        aria-label={`Select ${m.address}`}
                        className={styles.rowCheck}
                      />
                    </td>
                    {colPrefs.visible.map((col) => renderMailboxCell(col.id, m))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filteredMailboxes.length > 0 && paginationVisible && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            pageSize={{ value: limit, options: MAILBOX_PAGE_SIZES, onChange: changeLimit }}
            style={{ border: 'none', padding: '12px 4px' }}
          />
        )}
      </section>

      {selected && (
        <MailboxDrawer
          mailbox={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
