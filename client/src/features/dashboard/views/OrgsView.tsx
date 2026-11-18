import { useQuery } from '@tanstack/react-query';
import { Badge, Icon, ColumnFilterMenu } from '@/shared/components/ui';
import { getOrg } from '@/features/organizations/organizations.api';
import { listUsers } from '@/features/users/users.api';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import s from '@/styles/features/dashboard/views/views.module.css';

const ORG_COLUMNS: ColumnMeta[] = [
  { id: 'org',     label: 'Organization' },
  { id: 'domains', label: 'Domains' },
  { id: 'admin',   label: 'Admin' },
  { id: 'status',  label: 'Status' },
  { id: 'users',   label: 'Users' },
  { id: 'created', label: 'Created' },
];

export function OrgsView() {
  const org   = useQuery({ queryKey: ['org'],   queryFn: getOrg });
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers });

  const userCount = users.data?.length ?? 0;
  const colPrefs  = useColumnPrefs('orgs', ORG_COLUMNS);

  function renderOrgCell(colId: string) {
    if (!org.data) return null;
    switch (colId) {
      case 'org':
        return (
          <td key={colId}>
            <div className={s.cellName}>
              <span style={{
                width: 30, height: 30, borderRadius: 9, background: 'var(--accent-bg)',
                color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon name="building" size={14} />
              </span>
              <span className={s.subj}>{org.data.name}</span>
            </div>
          </td>
        );
      case 'domains':
        return <td key={colId} className={`${s.mono} ${s.t2}`}>{org.data.domains}</td>;
      case 'admin':
        return <td key={colId} className={s.t2}>{org.data.adminEmail}</td>;
      case 'status':
        return <td key={colId}><Badge tone="ok" dot>Active</Badge></td>;
      case 'users':
        return <td key={colId} className={`${s.numCol} ${s.tnum} ${s.t2}`}>{userCount.toLocaleString()}</td>;
      case 'created':
        return (
          <td key={colId} className={s.muted}>
            {new Date(org.data.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </td>
        );
      default:
        return null;
    }
  }

  return (
    <div className={s.page}>

      <div className={s.pageHead}>
        <div>
          <h2 className={s.pageHeadTitle}>Organization</h2>
          <p className={s.pageHeadSub}>
            {org.data ? `${userCount.toLocaleString()} user${userCount === 1 ? '' : 's'}` : 'Organization settings'}
          </p>
        </div>
        <div className={s.pageHeadRight}>
          <ColumnFilterMenu prefs={colPrefs} />
        </div>
      </div>

      <div className={s.card}>
        <div className={s.tableWrap}>
          <table className={s.tbl}>
            <thead>
              <tr>
                {colPrefs.visible.map((col) => (
                  <th key={col.id} className={col.id === 'users' ? s.numCol : undefined}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {org.isLoading && (
                <tr><td colSpan={colPrefs.visible.length}><div className={s.emptyState}><div className={s.emptyIcon}><Icon name="building" size={20} /></div>Loading organization…</div></td></tr>
              )}
              {org.isError && (
                <tr><td colSpan={colPrefs.visible.length}><div className={s.emptyState}><div className={s.emptyIcon}><Icon name="building" size={20} /></div>No organization configured yet.</div></td></tr>
              )}
              {org.data && (
                <tr>
                  {colPrefs.visible.map((col) => renderOrgCell(col.id))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
