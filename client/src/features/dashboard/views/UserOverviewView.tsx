import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { Badge, CardHead, Icon, ColumnFilterMenu } from '@/shared/components/ui';
import { listMessages } from '@/features/messages/messages.api';
import type { MessageRow } from '@/features/messages/messages.api';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import { View, viewPath } from '../dashboard.types';
import s from '@/styles/features/dashboard/views/views.module.css';

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

const IMPORTANCE_TONES: Record<string, 'danger' | 'warn' | 'neutral' | 'ok'> = {
  high:   'danger',
  normal: 'neutral',
  low:    'ok',
};

const RECENT_EMAILS_COLUMNS: ColumnMeta[] = [
  { id: 'subject',    label: 'Subject' },
  { id: 'from',       label: 'From' },
  { id: 'importance', label: 'Importance' },
  { id: 'date',       label: 'Date' },
];

function renderRecentEmailCell(colId: string, e: MessageRow) {
  switch (colId) {
    case 'subject':
      return (
        <td key={colId} className={s.tdWide}>
          <div className={s.cellName}>
            {!e.isRead && <span className={s.unreadDot} />}
            <span className={`${s.subj} ${s.truncSubj}`}>{e.subject ?? '(no subject)'}</span>
          </div>
        </td>
      );
    case 'from':
      return <td key={colId} className={`${s.t2} ${s.tdFrom}`}>{e.fromName ?? e.fromAddress}</td>;
    case 'importance':
      return <td key={colId}><Badge tone={IMPORTANCE_TONES[e.importance] ?? 'neutral'} dot>{e.importance}</Badge></td>;
    case 'date':
      return <td key={colId} className={s.muted}>{fmtDate(e.receivedAt)}</td>;
    default:
      return null;
  }
}

export function UserOverviewView() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const firstName = user?.displayName?.split(' ')[0] ?? 'there';

  const { data: emailsData } = useQuery({
    queryKey: ['messages', { page: 1, limit: 5 }],
    queryFn:  () => listMessages({ page: 1, limit: 5 }),
    staleTime: 30_000,
  });
  const recentEmails = emailsData?.messages ?? [];
  const colPrefs = useColumnPrefs('recent-emails', RECENT_EMAILS_COLUMNS);

  return (
    <div className={s.page}>

      {/* Welcome */}
      <div className={s.welcomeSection}>
        <h2 className={s.welcomeTitle}>Welcome back, {firstName}</h2>
        <p className={`${s.muted} ${s.welcomeSub}`}>
          Here's a summary of your email activity.
        </p>
      </div>

      {/* Quick search */}
      <div
        className={s.quickSearch}
        onClick={() => navigate(viewPath(View.Search))}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && navigate(viewPath(View.Search))}
      >
        <span className={s.accentIcon}><Icon name="sparkle" size={16} /></span>
        <span className={s.quickSearchPlaceholder}>Ask anything about your email…</span>
        <kbd className={s.kbdShortcut}>Search</kbd>
      </div>

      {/* Recent emails + attachments */}
      <div className={s.cols2} style={{ marginBottom: 16 }}>

        <div className={s.card}>
          <CardHead
            title="Recent emails"
            sub="Your latest indexed messages"
            icon="mail"
            action={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ColumnFilterMenu prefs={colPrefs} />
                <button className={s.linkMini} onClick={() => navigate(viewPath(View.Emails))}>
                  View all <Icon name="chevR" size={12} />
                </button>
              </div>
            }
          />
          <div className={s.tableWrap}>
            {recentEmails.length === 0 ? (
              <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="mail" size={20} /></div>No emails indexed yet.</div>
            ) : (
              <table className={s.tbl}>
                <thead>
                  <tr>
                    {colPrefs.visible.map((col) => <th key={col.id}>{col.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {recentEmails.map(e => (
                    <tr key={e.id}>
                      {colPrefs.visible.map((col) => renderRecentEmailCell(col.id, e))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className={s.card}>
          <CardHead
            title="Recent attachments"
            sub="Files from your emails"
            icon="clip"
            action={
              <button className={s.linkMini} onClick={() => navigate(viewPath(View.Attachments))}>
                View all <Icon name="chevR" size={12} />
              </button>
            }
          />
          <div className={s.tableWrap}>
            <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="clip" size={20} /></div>Attachment browsing coming soon.</div>
          </div>
        </div>

      </div>

      {/* Activity feed */}
      <div className={s.card}>
        <CardHead title="My recent activity" sub="Your latest actions" icon="activity" />
        <div className={s.cardBody} style={{ paddingTop: 8, paddingBottom: 8 }}>
          <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="activity" size={20} /></div>Activity feed coming soon.</div>
        </div>
      </div>

    </div>
  );
}
