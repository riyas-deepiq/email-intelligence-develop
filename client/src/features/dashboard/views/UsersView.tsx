import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { hasPermission } from '../access';
import { useToast } from '@/shared/toast/useToast';
import { Role, UserStatus } from '@/shared/types/enums';
import {
  cancelInvite,
  deactivateUser,
  inviteUser,
  listUsers,
  reactivateUser,
  resendInvite,
} from '@/features/users/users.api';
import type { UserRecord } from '@/features/users/users.types';
import { listAllMailboxes } from '@/features/mailboxes/mailboxes.api';
import type { Mailbox } from '@/features/mailboxes/mailboxes.api';
import { MailboxAvatar } from '@/features/mailboxes/MailboxAvatar';
import { queryAuditLog } from '@/features/audit/audit.api';
import { auditEventLabel, auditTargetLabel, auditCategory, auditCategoryTone, toneColorVars } from '@/features/audit/audit.labels';
import { Label, Avatar, UserCell, ColumnFilterMenu, Button, AsyncState, Icon, SearchField } from '@/shared/components/ui';
import { Modal } from '@/shared/components/Modal';
import { Drawer } from '@/shared/components/Drawer';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import { useSearchBarVisibility } from '@/shared/hooks/useSearchBarVisibility';
import { TablePagination } from './TablePagination';
import { assignUser, listOrgNodes } from '@/features/org-hierarchy/org-hierarchy.api';
import type { OrgNodeDto } from '@/features/org-hierarchy/org-hierarchy.api';
import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';

const USERS_PAGE_SIZES = [10, 25, 50] as const;

const AVATAR_COLORS = ['#7c3aed','#2563eb','#6366f1','#d97706','#8b5cf6','#0891b2'];
function avatarColor(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/**
 * A user who has never completed their first login still reads as "Invited" —
 * only once they've actually logged in at least once does the column switch to
 * reflecting real-time presence ("Active" while holding a live session,
 * "Inactive" otherwise: logged out, session expired, or deactivated).
 */
function displayStatus(u: UserRecord): { variant: 'ok' | 'down' | 'info'; label: string } {
  if (u.status === UserStatus.Invited && !u.lastLoginAt && !u.isOnline) {
    return { variant: 'info', label: 'Invited' };
  }
  return u.isOnline
    ? { variant: 'ok',   label: 'Active' }
    : { variant: 'down', label: 'Inactive' };
}

function displayRole(u: UserRecord): string {
  return u.roleName ?? u.role;
}

// ─── Per-user detail drawer (login/logout history + recent activity) ────────

function UserDetailDrawer({ user, onClose }: { user: UserRecord; onClose: () => void }) {
  const { variant, label } = displayStatus(user);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['user-audit', user.email],
    queryFn:  () => queryAuditLog({ actorEmail: user.email, limit: 20 }),
    staleTime: 30_000,
  });
  const entries = data?.data ?? [];

  return (
    <Drawer
      onClose={onClose}
      avatar={
        user.mailboxId
          ? <MailboxAvatar mailboxId={user.mailboxId} name={user.displayName} size={44} fallbackBg={avatarColor(user.id)} />
          : <Avatar name={user.displayName} size={44} color={avatarColor(user.id)} />
      }
      title={user.displayName}
      subtitle={user.email}
    >
      <div>
        <div className={styles.settingsRow} style={{ padding: '0.85rem 0', justifyContent: 'flex-start' }}>
          <span className={styles.settingsRowTitle} style={{ width: 96, flexShrink: 0 }}>Role</span>
          <Label variant={user.role === Role.SuperAdmin ? 'info' : user.role === Role.Admin ? 'warn' : 'ok'} size="sm">
            {displayRole(user)}
          </Label>
        </div>
        <div className={styles.settingsDivider} />
        <div className={styles.settingsRow} style={{ padding: '0.85rem 0', justifyContent: 'flex-start' }}>
          <span className={styles.settingsRowTitle} style={{ width: 96, flexShrink: 0 }}>Status</span>
          <Label variant={variant} size="sm" dot>{label}</Label>
        </div>
        <div className={styles.settingsDivider} />
        <div className={styles.settingsRow} style={{ padding: '0.85rem 0', justifyContent: 'flex-start' }}>
          <span className={styles.settingsRowTitle} style={{ width: 96, flexShrink: 0 }}>Joined</span>
          <span className={styles.tdMuted}>
            {new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div className={styles.settingsDivider} />
        <div className={styles.settingsRow} style={{ padding: '0.85rem 0', justifyContent: 'flex-start' }}>
          <span className={styles.settingsRowTitle} style={{ width: 96, flexShrink: 0 }}>Last login</span>
          <span className={styles.tdMuted}>
            {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never logged in'}
          </span>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <h3 style={{ fontSize: '0.85rem', fontWeight: 600, margin: '0 0 10px', color: 'var(--d-text-hi)' }}>
          Recent activity
        </h3>

        {isLoading && (
          <div className={styles.settingsPlaceholderBody}>
            <div className={styles.settingsPlaceholderLine} style={{ width: '60%' }} />
            <div className={styles.settingsPlaceholderLine} style={{ width: '45%' }} />
          </div>
        )}
        {isError && <div className={styles.tdMuted}>Failed to load activity.</div>}
        {!isLoading && !isError && entries.length === 0 && (
          <div className={styles.tdMuted}>No recorded activity yet.</div>
        )}

        {entries.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {entries.map((e) => {
              const tone = auditCategoryTone(e.entityType);
              const { fg, bg } = toneColorVars(tone);
              const target = e.entityType === 'session' ? null : auditTargetLabel(e.eventType, e.oldValue, e.newValue);
              return (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--d-border-sub)' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, background: bg, color: fg, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon name={auditCategory(e.entityType)?.icon ?? 'activity'} size={13} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: 'var(--d-text-hi)' }}>
                      {auditEventLabel(e.eventType)}{target ? ` · ${target}` : ''}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--d-text-dim)' }}>
                      {new Date(e.ts).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {e.ipAddress ? ` · ${e.ipAddress}` : ''}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Drawer>
  );
}

// ─── Invite User Modal ────────────────────────────────────────────────────────

interface InviteModalProps {
  onClose: () => void;
  mailboxes: Mailbox[];
  existingEmails: Set<string>;
  positions: OrgNodeDto[];
  canAssignHierarchy: boolean;
}

interface InviteEntry {
  email: string;
  positionId: string;
}

function apiError(error: unknown): string {
  return (error as { response?: { data?: { error?: { message?: string } } } })
    ?.response?.data?.error?.message ?? 'Invitation failed';
}

function InviteUserModal({
  onClose,
  mailboxes,
  existingEmails,
  positions,
  canAssignHierarchy,
}: InviteModalProps) {
  const toast = useToast();
  const qc    = useQueryClient();
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<InviteEntry[]>([]);

  const selectedEmails = new Set(entries.map((entry) => entry.email));
  const q = search.trim().toLowerCase();
  const visibleMailboxes = mailboxes
    .filter((mailbox) => !q || [
      mailbox.displayName,
      mailbox.address,
      mailbox.jobTitle,
      mailbox.departmentName,
    ].some((value) => value?.toLowerCase().includes(q)))
    .sort((a, b) =>
      (a.displayName ?? a.address).localeCompare(b.displayName ?? b.address),
    );
  const selectableVisible = visibleMailboxes.filter(
    (mailbox) => !existingEmails.has(mailbox.address.toLowerCase()),
  );
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every(
    (mailbox) => selectedEmails.has(mailbox.address.toLowerCase()),
  );
  const positionOptions = [
    { value: '', label: 'Assign later' },
    ...positions
      .filter((position) => !position.userId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
      .map((position) => ({
        value: position.id,
        label: `${position.department ? `${position.department} · ` : ''}${position.title}`,
      })),
  ];

  function toggleMailbox(email: string) {
    const normalized = email.toLowerCase();
    setEntries((current) => current.some((entry) => entry.email === normalized)
      ? current.filter((entry) => entry.email !== normalized)
      : [...current, { email: normalized, positionId: '' }]);
  }

  function toggleVisible() {
    const visibleEmails = new Set(selectableVisible.map((mailbox) => mailbox.address.toLowerCase()));
    setEntries((current) => allVisibleSelected
      ? current.filter((entry) => !visibleEmails.has(entry.email))
      : [
          ...current,
          ...selectableVisible
            .map((mailbox) => mailbox.address.toLowerCase())
            .filter((email) => !current.some((entry) => entry.email === email))
            .map((email) => ({ email, positionId: '' })),
        ]);
  }

  const mutation = useMutation({
    mutationFn: () => Promise.all(entries.map(async (entry) => {
      try {
        const result = await inviteUser(entry.email);
        let assignmentError = '';
        if (entry.positionId) {
          try {
            await assignUser(entry.positionId, result.user.id);
          } catch (error) {
            assignmentError = apiError(error);
          }
        }
        return { email: entry.email, invited: true, emailSent: result.emailSent, assignmentError };
      } catch (error) {
        return { email: entry.email, invited: false, emailSent: false, assignmentError: '', error: apiError(error) };
      }
    })),
    onSuccess: (results) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      qc.invalidateQueries({ queryKey: ['org-hierarchy'] });
      const invited = results.filter((result) => result.invited);
      const failed = results.filter((result) => !result.invited);
      const unsent = invited.filter((result) => !result.emailSent);
      const unassigned = invited.filter((result) => result.assignmentError);

      if (!failed.length && !unsent.length && !unassigned.length) {
        toast.success(`${invited.length} invitation${invited.length === 1 ? '' : 's'} sent.`);
      } else {
        const summary = [
          invited.length ? `${invited.length} account${invited.length === 1 ? '' : 's'} invited.` : '',
          failed.length ? `${failed.length} failed: ${failed.slice(0, 3).map((item) => item.email).join(', ')}.` : '',
          unsent.length ? `${unsent.length} email${unsent.length === 1 ? '' : 's'} not sent; use Resend.` : '',
          unassigned.length ? `${unassigned.length} hierarchy assignment${unassigned.length === 1 ? '' : 's'} failed.` : '',
        ].filter(Boolean).join(' ');
        toast.error(summary);
      }
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite users"
      width={760}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" loading={mutation.isPending} disabled={!entries.length} onClick={() => mutation.mutate()}>
            {mutation.isPending ? 'Inviting…' : `Invite ${entries.length || ''} user${entries.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className={styles.inviteComposer}>
        <div className={styles.invitePickerHead}>
          <div>
            <h3>Connected mailbox users</h3>
            <p>Select the users to invite, then optionally assign their hierarchy positions.</p>
          </div>
          {selectableVisible.length > 0 && (
            <button type="button" className={styles.inviteSelectAll} onClick={toggleVisible}>
              {allVisibleSelected ? 'Clear visible' : 'Select all visible'}
            </button>
          )}
        </div>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Search connected mailbox users…"
          aria-label="Search connected mailbox users"
          className={styles.inviteSearch}
        />
      </div>

      <div className={styles.inviteList} role="list" aria-label="Connected mailbox users">
        {visibleMailboxes.length > 0 ? visibleMailboxes.map((mailbox) => {
          const email = mailbox.address.toLowerCase();
          const selected = selectedEmails.has(email);
          const alreadyAdded = existingEmails.has(email);
          const entry = entries.find((item) => item.email === email);
          const usedPositions = new Set(
            entries.filter((item) => item.email !== email).map((item) => item.positionId),
          );
          return (
            <div
              key={mailbox.id}
              role="listitem"
              className={`${styles.inviteRow} ${selected ? styles.inviteRowSelected : ''} ${alreadyAdded ? styles.inviteRowDisabled : ''}`}
            >
              <label className={styles.inviteCheckTarget}>
                <input
                  type="checkbox"
                  className={styles.rowCheck}
                  checked={selected}
                  disabled={alreadyAdded}
                  onChange={() => toggleMailbox(email)}
                  aria-label={`Select ${mailbox.displayName ?? mailbox.address}`}
                />
              </label>
              <UserCell
                name={mailbox.displayName ?? mailbox.address}
                secondary={[mailbox.address, mailbox.jobTitle].filter(Boolean).join(' · ')}
                mailboxId={mailbox.id}
                size={34}
              />
              {alreadyAdded ? (
                <span className={styles.inviteAddedBadge}>Already added</span>
              ) : selected && canAssignHierarchy ? (
                <select
                  className={styles.invitePositionSelect}
                  value={entry?.positionId ?? ''}
                  onChange={(event) => setEntries((current) => current.map((item) =>
                    item.email === email ? { ...item, positionId: event.target.value } : item,
                  ))}
                  aria-label={`Hierarchy position for ${mailbox.displayName ?? mailbox.address}`}
                >
                  {positionOptions
                    .filter((option) => !option.value || option.value === entry?.positionId || !usedPositions.has(option.value))
                    .map((option) => <option key={option.value || 'later'} value={option.value}>{option.label}</option>)}
                </select>
              ) : (
                <span className={styles.inviteAssignmentHint}>
                  {canAssignHierarchy ? 'Select to assign' : 'Ready to invite'}
                </span>
              )}
            </div>
          );
        }) : (
          <div className={styles.inviteEmpty}>
            {mailboxes.length ? 'No mailbox users match your search.' : 'No connected mailbox users found.'}
          </div>
        )}
      </div>

      <div className={styles.inviteSummary} aria-live="polite">
        <strong>{entries.length}</strong> user{entries.length === 1 ? '' : 's'} selected
        {canAssignHierarchy && entries.length > 0 && (
          <span>
            · {entries.filter((entry) => entry.positionId).length} position{entries.filter((entry) => entry.positionId).length === 1 ? '' : 's'} assigned
          </span>
        )}
      </div>

      {canAssignHierarchy && positionOptions.length === 1 && (
        <p className={styles.inviteHint}>No unassigned hierarchy positions are available. Users can be assigned later.</p>
      )}
    </Modal>
  );
}

// ─── Main users table columns (show/hide + reorder via the Filter menu) ──────

const USERS_COLUMNS: ColumnMeta[] = [
  { id: 'name',   label: 'Name' },
  { id: 'email',  label: 'Email' },
  { id: 'role',   label: 'Role' },
  { id: 'status', label: 'Status' },
  { id: 'joined', label: 'Joined' },
];

function renderUserCell(colId: string, u: UserRecord) {
  switch (colId) {
    case 'name':
      return <td key={colId}><UserCell name={u.displayName} mailboxId={u.mailboxId ?? undefined} size={24} fallbackBg={avatarColor(u.id)} /></td>;
    case 'email':
      return <td key={colId} className={styles.tdMuted}>{u.email}</td>;
    case 'role':
      return (
        <td key={colId}>
          <Label variant={u.role === Role.SuperAdmin ? 'info' : u.role === Role.Admin ? 'warn' : 'ok'} size="sm">
            {displayRole(u)}
          </Label>
        </td>
      );
    case 'status': {
      const { variant, label } = displayStatus(u);
      return (
        <td key={colId}>
          <Label variant={variant} size="sm" dot>{label}</Label>
        </td>
      );
    }
    case 'joined':
      return (
        <td key={colId} className={styles.tdMuted}>
          {new Date(u.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
        </td>
      );
    default:
      return null;
  }
}

// ─── View ─────────────────────────────────────────────────────────────────────

// ─── Per-row user actions ─────────────────────────────────────────────────────

interface UserActionsProps {
  target: UserRecord;
  currentUserId: string | null;
}

function UserActions({ target, currentUserId }: UserActionsProps) {
  const toast = useToast();
  const qc    = useQueryClient();

  const deactivateMut = useMutation({
    mutationFn: () => deactivateUser(target.id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success(`${target.displayName} deactivated.`); },
    onError:    () => toast.error('Failed to deactivate user.'),
  });

  const reactivateMut = useMutation({
    mutationFn: () => reactivateUser(target.id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['users'] }); toast.success(`${target.displayName} reactivated.`); },
    onError:    () => toast.error('Failed to reactivate user.'),
  });

  const resendMut = useMutation({
    mutationFn: () => resendInvite(target.id),
    onSuccess: ({ emailSent }) => {
      if (emailSent) toast.success(`Invitation resent to ${target.email}.`);
      else toast.error('Invitation email was not sent. Check the SMTP configuration and try again.');
    },
    onError: (error: unknown) => toast.error(apiError(error)),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelInvite(target.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      qc.invalidateQueries({ queryKey: ['org-hierarchy'] });
      toast.success(`Invitation for ${target.email} cancelled.`);
    },
    onError: (error: unknown) => toast.error(apiError(error)),
  });

  // Don't let users manage themselves or superadmins
  const isSelf        = currentUserId === target.id;
  const isSuperAdmin  = target.role === Role.SuperAdmin;
  if (isSelf || isSuperAdmin) return null;

  const isInactive = target.status === UserStatus.Inactive;
  const isInvited = target.status === UserStatus.Invited;

  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {isInvited ? (
        <>
          <button
            type="button"
            className={styles.actionBtnPrimary}
            onClick={() => resendMut.mutate()}
            disabled={resendMut.isPending || cancelMut.isPending}
          >
            {resendMut.isPending ? 'Sending…' : 'Resend'}
          </button>
          <button
            type="button"
            className={styles.actionBtnDanger}
            onClick={() => {
              if (window.confirm(`Cancel the invitation for ${target.email}?`)) cancelMut.mutate();
            }}
            disabled={resendMut.isPending || cancelMut.isPending}
          >
            {cancelMut.isPending ? 'Cancelling…' : 'Cancel invite'}
          </button>
        </>
      ) : isInactive ? (
        <button
          onClick={() => reactivateMut.mutate()}
          disabled={reactivateMut.isPending}
          style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, border: '1px solid #22c55e', background: 'transparent', cursor: 'pointer', color: '#22c55e', whiteSpace: 'nowrap' }}
        >
          {reactivateMut.isPending ? '…' : 'Reactivate'}
        </button>
      ) : (
        <button
          onClick={() => deactivateMut.mutate()}
          disabled={deactivateMut.isPending}
          style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, border: '1px solid #ef4444', background: 'transparent', cursor: 'pointer', color: '#ef4444', whiteSpace: 'nowrap' }}
        >
          {deactivateMut.isPending ? '…' : 'Deactivate'}
        </button>
      )}
    </div>
  );
}

export function UsersView() {
  const { user }  = useAuth();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage]   = useState(1);
  const [limit, setLimit] = useState<number>(USERS_PAGE_SIZES[0]);

  const canManage = hasPermission(user, 'users.manage');
  const canAssignHierarchy = user?.role === Role.SuperAdmin;

  const { data: users,     isLoading: usersLoading,     isError: usersError } = useQuery({
    queryKey: ['users'], queryFn: listUsers,
  });
  const { data: mailboxes, isLoading: mailboxesLoading                      } = useQuery({ queryKey: ['mailboxes', 'all'], queryFn: listAllMailboxes });
  const { data: hierarchy } = useQuery({
    queryKey: ['org-hierarchy'],
    queryFn: listOrgNodes,
    enabled: canAssignHierarchy,
  });

  const colPrefs = useColumnPrefs('users', USERS_COLUMNS);
  const [searchVisible, setSearchVisible] = useSearchBarVisibility('users');
  const [paginationVisible, setPaginationVisible] = useSearchBarVisibility('users-pagination');

  // Clearing the query when the bar is hidden keeps a stale filter from
  // silently narrowing the list once the search field is gone.
  function toggleSearchVisible(next: boolean) {
    setSearchVisible(next);
    if (!next) setSearch('');
  }

  const isLoading = usersLoading || mailboxesLoading;

  // Build sets to identify auto-imported mailbox users (no real login credentials)
  const mailboxOwnerIds  = new Set((mailboxes ?? []).filter((m) => m.ownerUserId).map((m) => m.ownerUserId!));
  const mailboxEmailSet  = new Set((mailboxes ?? []).map((m) => m.address.toLowerCase()));

  // Only show users with actual platform accounts.
  // Exclude employees that were auto-created from a mailbox import (they have no login).
  const platformUsers = (users ?? []).filter((u) => {
    if (u.role === Role.SuperAdmin) return true;
    if (u.status === 'invited' || u.status === 'pending_setup') return true;
    // A user who has actually logged in is a real platform account regardless of
    // mailbox linkage — only hide mailbox-linked accounts that never logged in
    // (auto-imported placeholders with no real login).
    if (u.lastLoginAt) return true;
    const linkedToMailbox = mailboxOwnerIds.has(u.id) || mailboxEmailSet.has(u.email.toLowerCase());
    return !linkedToMailbox;
  });

  // Free-text filter across name, email, and role.
  const q = search.trim().toLowerCase();
  const visibleUsers = q
    ? platformUsers.filter((u) =>
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        displayRole(u).toLowerCase().includes(q),
      )
    : platformUsers;

  const totalCount   = platformUsers.length;
  const visibleCount = visibleUsers.length;

  // Client-side pagination over the (filtered) list. Snap the page back into
  // range whenever the result set shrinks (e.g. after a search) so we never
  // land on an empty page past the end.
  const totalPages   = Math.max(1, Math.ceil(visibleCount / limit));
  const currentPage  = Math.min(page, totalPages);
  const pageUsers    = visibleUsers.slice((currentPage - 1) * limit, currentPage * limit);

  // Reset to the first page whenever the query or page size changes.
  useEffect(() => { setPage(1); }, [search, limit]);

  return (
    <div className={styles.adminPage}>
      <section className={styles.adminSection}>
        <div className={styles.adminSectionHead}>
          <div>
            <h2 className={styles.adminSectionTitle}>Users</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {!isLoading && (
              <span className={styles.adminCount}>
                {q
                  ? `${visibleCount} of ${totalCount} member${totalCount !== 1 ? 's' : ''}`
                  : `${totalCount} member${totalCount !== 1 ? 's' : ''}`}
              </span>
            )}
            {!isLoading && searchVisible && (
              <SearchField
                value={search}
                onChange={setSearch}
                placeholder="Search by name, email or role…"
              />
            )}
            <ColumnFilterMenu
              prefs={colPrefs}
              searchToggle={{ visible: searchVisible, onToggleVisible: toggleSearchVisible }}
              paginationToggle={{ visible: paginationVisible, onToggleVisible: setPaginationVisible }}
            />
            {canManage && (
              <Button size="sm" onClick={() => setInviteOpen(true)}>+ Invite users</Button>
            )}
          </div>
        </div>

        {isLoading && <AsyncState variant="loading">Loading users…</AsyncState>}
        {usersError && <AsyncState variant="error">Failed to load users.</AsyncState>}
        {!isLoading && (
          <div className={styles.tableWrap} style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--d-surface, var(--surface-white, #fff))' }}>
                  {colPrefs.visible.map((col) => <th key={col.id}>{col.label}</th>)}
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    style={{ opacity: u.status === UserStatus.Inactive ? 0.6 : 1, cursor: 'pointer' }}
                  >
                    {colPrefs.visible.map((col) => renderUserCell(col.id, u))}
                    {canManage && (
                      <td onClick={(e) => e.stopPropagation()}>
                        <UserActions target={u} currentUserId={user?.id ?? null} />
                      </td>
                    )}
                  </tr>
                ))}

                {visibleCount === 0 && (
                  <tr>
                    <td colSpan={colPrefs.visible.length + (canManage ? 1 : 0)} style={{ textAlign: 'center', color: 'var(--d-text-dim)', padding: '20px 0' }}>
                      {q ? `No users match “${search.trim()}”.` : 'No users found.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!isLoading && paginationVisible && visibleCount > 0 && (
          <TablePagination
            page={currentPage}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            pageSize={{ value: limit, options: USERS_PAGE_SIZES, onChange: setLimit }}
          />
        )}
      </section>

      {selectedUser && <UserDetailDrawer user={selectedUser} onClose={() => setSelectedUser(null)} />}

      {inviteOpen && (
        <InviteUserModal
          onClose={() => setInviteOpen(false)}
          mailboxes={mailboxes ?? []}
          positions={hierarchy?.nodes ?? []}
          canAssignHierarchy={canAssignHierarchy}
          existingEmails={new Set(
            (users ?? [])
              .filter((u) => {
                // Always block re-inviting admins/superadmins and already-invited users
                if (u.role === Role.SuperAdmin) return true;
                if (u.status === 'invited' || u.status === 'pending_setup') return true;
                // A user who has actually logged in already has a real account —
                // block them from being offered again regardless of mailbox linkage.
                if (u.lastLoginAt) return true;
                // Auto-created mailbox employees (no real login) can be invited
                const linkedToMailbox = mailboxOwnerIds.has(u.id) || mailboxEmailSet.has(u.email.toLowerCase());
                return !linkedToMailbox;
              })
              .map((u) => u.email.toLowerCase()),
          )}
        />
      )}
    </div>
  );
}
