import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { Badge, Icon } from '@/shared/components/ui';
import type { BadgeTone } from '@/shared/components/ui';
import { usePaletteRamp } from '@/shared/hooks/usePaletteRamp';
import { listAlerts, markAllAlertsRead, markAlertRead, type Alert } from '@/features/alerts/alerts.api';
import { getMailbox } from '@/features/mailboxes/mailboxes.api';
import { Drawer } from '@/shared/components/Drawer';
import { timeAgo } from '@/shared/utils/time';
import { hasPermission } from '../access';
import s from '@/styles/features/dashboard/views/views.module.css';

function sevTone(sev: string): BadgeTone {
  if (sev === 'critical') return 'danger';
  if (sev === 'warning')  return 'warn';
  return 'accent';
}

const SEV_FILTERS = ['All', 'Critical', 'Warning', 'Info'] as const;

function fmtFull(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function AlertDetailDrawer({ alert, onClose }: { alert: Alert; onClose: () => void }) {
  const { data: mailbox } = useQuery({
    queryKey: ['mailbox', alert.mailboxId],
    queryFn:  () => getMailbox(alert.mailboxId!),
    enabled:  !!alert.mailboxId,
  });

  return (
    <Drawer
      onClose={onClose}
      title={alert.title}
      subtitle={`${alert.category} · ${timeAgo(alert.createdAt)}`}
      avatar={
        <span style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: `var(--${sevTone(alert.severity)}-bg, var(--surface-2))`,
          color: `var(--${sevTone(alert.severity)})`,
        }}>
          <Icon name={alert.category === 'Security' || alert.category === 'DLP' ? 'shield' : 'alert'} size={18} />
        </span>
      }
    >
      <section>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-lo, #6b7280)', marginBottom: 10 }}>
          Details
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[
            { label: 'Severity', value: <Badge tone={sevTone(alert.severity)}>{alert.severity}</Badge> },
            { label: 'Category', value: alert.category },
            { label: 'Source',   value: alert.source },
            { label: 'Status',   value: alert.read ? 'Read' : 'Unread' },
            { label: 'Mailbox',  value: alert.mailboxId ? (mailbox?.address ?? 'Loading…') : '—' },
            { label: 'Occurred', value: fmtFull(alert.createdAt) },
          ].map(({ label, value }) => (
            <div key={label} style={{ background: 'var(--surface-gray, #f9fafb)', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 11, color: 'var(--text-lo, #6b7280)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-hi, #111)' }}>{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-lo, #6b7280)', marginBottom: 10 }}>
          Full message
        </div>
        <div style={{
          background: 'var(--surface-gray, #f9fafb)', borderRadius: 8, padding: '12px 14px',
          fontSize: 13, lineHeight: 1.55, color: 'var(--text-md, #374151)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        }}>
          {alert.description}
        </div>
      </section>
    </Drawer>
  );
}

function exactTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function AlertsView() {
  const { user } = useAuth();
  const canManageAlerts = hasPermission(user, 'alerts.manage');
  const [sev, setSev] = useState('All');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const qc = useQueryClient();

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn:  listAlerts,
  });
  const ALERTS = alerts ?? [];
  // Derived from live query data (not a click-time snapshot) so the drawer
  // reflects the read status flipping to true right after it's marked.
  const selected = ALERTS.find((a) => a.id === selectedId) ?? null;

  const markAllReadMut = useMutation({
    mutationFn: markAllAlertsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const markReadMut = useMutation({
    mutationFn: markAlertRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const openAlert = (a: Alert) => {
    setSelectedId(a.id);
    if (!a.read) markReadMut.mutate(a.id);
  };

  const rows = sev === 'All' ? ALERTS : ALERTS.filter(a => a.severity === sev.toLowerCase());
  // "open" = unread — these counts reduce as alerts get read, matching the
  // "open across org" label.
  const counts = {
    critical: ALERTS.filter(a => a.severity === 'critical' && !a.read).length,
    warning:  ALERTS.filter(a => a.severity === 'warning'  && !a.read).length,
    info:     ALERTS.filter(a => a.severity === 'info'     && !a.read).length,
  };

  const paletteColors = usePaletteRamp(5);

  return (
    <div className={s.page}>

      {/* Summary stats */}
      <div className={s.cols3} style={{ marginBottom: 16 }}>
        {([['Critical', counts.critical, 'alert'], ['Warning', counts.warning, 'bell'], ['Informational', counts.info, 'eye']] as const).map(([lab, n, icon], i) => (
          <div key={lab} className={`${s.card} ${s.alertStatCard}`}>
            <span className={s.alertStatIcon} style={{
              background: `linear-gradient(135deg, ${paletteColors[i % 3]}, color-mix(in srgb, ${paletteColors[i % 3]} 62%, #ffffff))`,
              boxShadow: `0 6px 16px -4px ${paletteColors[i % 3]}66`,
              color: '#ffffff',
            }}>
              <Icon name={icon} size={16} />
            </span>
            <div className={s.alertStatBody}>
              <div className={s.alertCount}>{n}</div>
              <div className={s.alertStatLabel}>{lab} · open {canManageAlerts ? 'across org' : 'for you'}</div>
            </div>
          </div>
        ))}
      </div>

      <div className={s.pageHead}>
        <div className={s.chips}>
          {SEV_FILTERS.map(f => (
            <button
              key={f}
              className={`${s.chip} ${sev === f ? s.chipActive : ''}`}
              onClick={() => setSev(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className={s.pageHeadRight}>
          <button
            className={s.btn}
            onClick={() => markAllReadMut.mutate()}
            disabled={markAllReadMut.isPending || ALERTS.every((a) => a.read)}
          >
            <Icon name="check" size={14} /> Mark all read
          </button>
        </div>
      </div>

      <div className={s.card}>
        <div className={s.cardBody} style={{ paddingTop: 4, paddingBottom: 4 }}>
          {rows.length === 0 ? (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}><Icon name="check" size={20} /></div>
              No alerts {canManageAlerts ? 'across the organisation' : 'for you'}.
            </div>
          ) : rows.map(a => (
            <div
              key={a.id}
              className={s.feedItem}
              style={{ opacity: a.read ? 0.6 : 1, cursor: 'pointer' }}
              onClick={() => openAlert(a)}
            >
              <span className={s.feedIcon} style={{
                background: `var(--${sevTone(a.severity)}-bg, var(--surface-2))`,
                color: `var(--${sevTone(a.severity)})`,
              }}>
                <Icon name={a.category === 'Security' || a.category === 'DLP' ? 'shield' : 'alert'} size={17} />
              </span>
              <div className={s.alertItemContent}>
                <div className={s.alertItemHead}>
                  <span className={s.alertTitle}>{a.title}</span>
                  <Badge tone={sevTone(a.severity)}>{a.severity}</Badge>
                  <Badge tone="neutral">{a.category}</Badge>
                </div>
                <div className={s.muted}>{a.description}</div>
              </div>
              <div className={s.alertItemEnd}>
                <span className={s.muted}>{exactTime(a.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {selected && <AlertDetailDrawer alert={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
