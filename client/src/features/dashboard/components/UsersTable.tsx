import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Role, UserStatus } from '@/shared/types/enums';
import { deactivateUser, reactivateUser } from '@/features/users/users.api';
import type { UserRecord } from '@/features/users/users.types';
import { useToast } from '@/shared/toast/useToast';
import { ROLE_LABEL } from '../dashboard.types';
import { Label, UserCell, type LabelVariant } from '@/shared/components/ui';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';

const ROLE_VARIANT: Record<string, LabelVariant> = {
  superadmin: 'info',
  admin:      'warn',
  employee:   'ok',
};

const STATUS_VARIANT: Record<string, LabelVariant> = {
  active:        'ok',
  inactive:      'down',
  invited:       'info',
  pending_setup: 'neutral',
};

interface UsersTableProps {
  users: UserRecord[];
  canManage?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  active:   'Active',
  inactive: 'Inactive',
  invited:  'Invited',
  pending_setup: 'Setup pending',
};

export function UsersTable({ users, canManage = false }: UsersTableProps) {
  const toast = useToast();
  const qc    = useQueryClient();

  const deactivateMut = useMutation({
    mutationFn: deactivateUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deactivated.');
    },
    onError: () => toast.error('Failed to deactivate user.'),
  });

  const reactivateMut = useMutation({
    mutationFn: reactivateUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User reactivated.');
    },
    onError: () => toast.error('Failed to reactivate user.'),
  });

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            {canManage && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} style={{ opacity: u.status === UserStatus.Inactive ? 0.6 : 1 }}>
              <td>
                <UserCell name={u.displayName} mailboxId={u.mailboxId ?? undefined} size={24} />
              </td>
              <td className={styles.tdMuted}>{u.email}</td>
              <td>
                <Label variant={ROLE_VARIANT[u.role] ?? 'neutral'} size="sm">
                  {u.roleName ?? ROLE_LABEL[u.role as Role] ?? u.role}
                </Label>
              </td>
              <td>
                <Label variant={STATUS_VARIANT[u.status] ?? 'neutral'} size="sm" dot>
                  {STATUS_LABEL[u.status] ?? u.status}
                </Label>
              </td>
              <td className={styles.tdMuted}>
                {new Date(u.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                })}
              </td>
              {canManage && (
                <td>
                  {u.status !== UserStatus.Inactive ? (
                    <button
                      className={styles.actionBtnDanger}
                      onClick={() => deactivateMut.mutate(u.id)}
                      disabled={deactivateMut.isPending || reactivateMut.isPending}
                    >
                      Deactivate
                    </button>
                  ) : (
                    <button
                      className={styles.actionBtnPrimary}
                      onClick={() => reactivateMut.mutate(u.id)}
                      disabled={deactivateMut.isPending || reactivateMut.isPending}
                    >
                      Reactivate
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
