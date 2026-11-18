import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  assignUserRole,
  createRole,
  deleteRole,
  listRoles,
  updateRole,
} from '@/features/roles/roles.api';
import type {
  PermissionCatalogItem,
  RoleDefinition,
  SaveRolePayload,
} from '@/features/roles/roles.types';
import { listAllMailboxes } from '@/features/mailboxes/mailboxes.api';
import type { Mailbox } from '@/features/mailboxes/mailboxes.api';
import { createUserFromMailbox, listUsers } from '@/features/users/users.api';
import type { UserRecord } from '@/features/users/users.types';
import { Role } from '@/shared/types/enums';
import { useToast } from '@/shared/toast/useToast';
import { AsyncState, Button, Combobox, Icon, Label, UserCell } from '@/shared/components/ui';
import s from '@/styles/features/dashboard/views/views.module.css';

type RoleDraft = SaveRolePayload;

const DEFAULT_DRAFT: RoleDraft = {
  name: '',
  description: '',
  baseRole: Role.Employee,
  permissions: [],
};

const SYSTEM_ROLE_LABEL: Record<string, string> = {
  [Role.Employee]: 'Employee',
  [Role.Admin]: 'Admin',
  [Role.SuperAdmin]: 'Super Admin',
};

interface MailboxAssignee {
  mailbox: Mailbox;
  user: UserRecord | null;
  name: string;
  email: string;
  secondary: string;
}

function roleDisplayName(user: UserRecord): string {
  return user.roleName ?? SYSTEM_ROLE_LABEL[user.role] ?? user.role;
}

function hasAssignedRole(user: UserRecord): boolean {
  return user.roleId !== null || user.role !== Role.Employee;
}

function mailboxAssigneeSecondary(mailbox: Mailbox): string {
  const profile = [mailbox.jobTitle, mailbox.departmentName].filter(Boolean).join(' - ');
  return profile ? `${profile} - ${mailbox.address}` : mailbox.address;
}

function groupPermissions(
  items: PermissionCatalogItem[],
): Array<[string, PermissionCatalogItem[]]> {
  const groups = new Map<string, PermissionCatalogItem[]>();
  for (const item of items) {
    groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  }
  return [...groups.entries()];
}

function roleTone(role: RoleDefinition): 'ok' | 'warn' | 'info' {
  if (role.baseRole === Role.SuperAdmin) return 'info';
  return role.baseRole === Role.Admin ? 'warn' : 'ok';
}

export function RolesView() {
  const toast = useToast();
  const qc = useQueryClient();

  const rolesQ = useQuery({ queryKey: ['roles'], queryFn: listRoles });
  const usersQ = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const mailboxesQ = useQuery({ queryKey: ['mailboxes', 'all'], queryFn: listAllMailboxes });

  const roles = useMemo(() => rolesQ.data?.roles ?? [], [rolesQ.data?.roles]);
  const users = useMemo(() => usersQ.data ?? [], [usersQ.data]);
  const mailboxes = useMemo(() => mailboxesQ.data ?? [], [mailboxesQ.data]);
  const permissions = useMemo(() => rolesQ.data?.permissions ?? [], [rolesQ.data?.permissions]);
  const assignableRoles = useMemo(
    () => roles.filter((role) => role.id !== 'system:superadmin'),
    [roles],
  );
  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const usersByEmail = useMemo(
    () => new Map(users.map((user) => [user.email.toLowerCase(), user])),
    [users],
  );

  const assignableMailboxUsers = useMemo<MailboxAssignee[]>(() => {
    const seenAddresses = new Set<string>();

    return mailboxes
      .flatMap((mailbox) => {
        const emailKey = mailbox.address.toLowerCase();
        if (seenAddresses.has(emailKey)) return [];
        seenAddresses.add(emailKey);

        const user =
          (mailbox.ownerUserId ? usersById.get(mailbox.ownerUserId) : undefined) ??
          usersByEmail.get(emailKey) ??
          null;
        if (user?.role === Role.SuperAdmin) return [];

        return [
          {
            mailbox,
            user,
            name: mailbox.displayName ?? user?.displayName ?? mailbox.address,
            email: mailbox.address,
            secondary: mailboxAssigneeSecondary(mailbox),
          },
        ];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [mailboxes, usersByEmail, usersById]);
  const assignedMailboxUsers = useMemo(
    () =>
      assignableMailboxUsers.filter(
        (item): item is MailboxAssignee & { user: UserRecord } =>
          item.user !== null && hasAssignedRole(item.user),
      ),
    [assignableMailboxUsers],
  );
  const unassignedMailboxUsers = useMemo(
    () => assignableMailboxUsers.filter((item) => !item.user || !hasAssignedRole(item.user)),
    [assignableMailboxUsers],
  );

  const [activeId, setActiveId] = useState<string | undefined>();
  const [draft, setDraft] = useState<RoleDraft>(DEFAULT_DRAFT);
  // Which permission categories are collapsed. Empty = all open (the default),
  // so the matrix reads the same on first view and users opt into hiding groups.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroupCollapse = (group: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  const [selectedMailboxId, setSelectedMailboxId] = useState('');
  const [selectedAssignRole, setSelectedAssignRole] = useState('');
  const selectedAssignee =
    assignableMailboxUsers.find((item) => item.mailbox.id === selectedMailboxId) ?? null;
  const selectedHasAssignedRole = selectedAssignee?.user
    ? hasAssignedRole(selectedAssignee.user)
    : false;
  const selectedUserOption = selectedAssignee && selectedHasAssignedRole ? [selectedAssignee] : [];
  const userSelectOptions = [...selectedUserOption, ...unassignedMailboxUsers].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.mailbox.id === item.mailbox.id) === index,
  );

  const activeRole = roles.find((role) => role.id === activeId) ?? null;
  const isCreating = activeId === 'new';
  const isSystemRole = !!activeRole?.isSystem;
  const canEdit = isCreating || (!!activeRole && !activeRole.isSystem);

  useEffect(() => {
    if (activeId === undefined && roles.length > 0) setActiveId(roles[0].id);
  }, [activeId, roles]);

  useEffect(() => {
    if (activeRole) {
      setDraft({
        name: activeRole.name,
        description: activeRole.description,
        baseRole: activeRole.baseRole === Role.Admin ? Role.Admin : Role.Employee,
        permissions: activeRole.permissions,
      });
    } else if (isCreating) {
      setDraft(DEFAULT_DRAFT);
    }
  }, [activeRole, isCreating]);

  useEffect(() => {
    if (
      selectedMailboxId &&
      !assignableMailboxUsers.some((item) => item.mailbox.id === selectedMailboxId)
    ) {
      setSelectedMailboxId('');
    }
  }, [assignableMailboxUsers, selectedMailboxId]);

  useEffect(() => {
    if (!selectedAssignRole && assignableRoles.length > 0)
      setSelectedAssignRole(assignableRoles[0].id);
  }, [assignableRoles, selectedAssignRole]);

  const permissionGroups = useMemo(() => groupPermissions(permissions), [permissions]);
  const permissionColumns = useMemo(() => {
    const columns: Array<Array<[string, PermissionCatalogItem[]]>> = [[], []];
    permissionGroups.forEach((group, index) => {
      columns[index % columns.length].push(group);
    });
    return columns;
  }, [permissionGroups]);

  const saveMut = useMutation({
    mutationFn: () => {
      if (isCreating) return createRole(draft);
      if (!activeRole || activeRole.isSystem) throw new Error('Select a custom role to update');
      return updateRole(activeRole.id, draft);
    },
    onSuccess: (role) => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setActiveId(role.id);
      toast.success(isCreating ? 'Role created.' : 'Role updated.');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Failed to save role.';
      toast.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (roleId: string) => deleteRole(roleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setActiveId(undefined);
      toast.success('Role deleted.');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Failed to delete role.';
      toast.error(msg);
    },
  });

  const assignMut = useMutation({
    mutationFn: async () => {
      const assignee = selectedAssignee;
      if (!assignee || !selectedAssignRole) throw new Error('Select a user and role');

      let userId = assignee.user?.id;
      if (!userId || assignee.mailbox.ownerUserId !== userId) {
        const user = await createUserFromMailbox(assignee.mailbox.id);
        userId = user.id;
      }

      if (selectedAssignRole.startsWith('system:')) {
        const systemRole = selectedAssignRole.slice('system:'.length) as Role.Employee | Role.Admin;
        return assignUserRole(userId, { systemRole });
      }
      return assignUserRole(userId, { roleId: selectedAssignRole });
    },
    onSuccess: () => {
      setSelectedMailboxId('');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success('Role assigned.');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Failed to assign role.';
      toast.error(msg);
    },
  });

  const unassignMut = useMutation({
    mutationFn: async () => {
      if (!selectedAssignee?.user) throw new Error('Select an assigned user');
      return assignUserRole(selectedAssignee.user.id, { systemRole: Role.Employee });
    },
    onSuccess: () => {
      setSelectedMailboxId('');
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['roles'] });
      qc.invalidateQueries({ queryKey: ['mailboxes'] });
      toast.success('Role unassigned.');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Failed to unassign role.';
      toast.error(msg);
    },
  });

  const togglePermission = (permissionId: string) => {
    if (!canEdit) return;
    setDraft((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(permissionId)
        ? prev.permissions.filter((id) => id !== permissionId)
        : [...prev.permissions, permissionId],
    }));
  };

  /** Select-all / clear for a whole permission group — with 16+ permissions
   *  spread across groups, ticking them one at a time is the main friction. */
  const toggleGroup = (items: PermissionCatalogItem[]) => {
    if (!canEdit) return;
    const ids = items.map((i) => i.id);
    setDraft((prev) => {
      const allOn = ids.every((id) => prev.permissions.includes(id));
      return {
        ...prev,
        permissions: allOn
          ? prev.permissions.filter((id) => !ids.includes(id))
          : [...new Set([...prev.permissions, ...ids])],
      };
    });
  };

  const startCreate = () => {
    setActiveId('new');
    setDraft(DEFAULT_DRAFT);
  };

  if (rolesQ.isLoading || usersQ.isLoading || mailboxesQ.isLoading) {
    return <AsyncState variant="loading">Loading roles and permissions...</AsyncState>;
  }

  if (rolesQ.isError || usersQ.isError || mailboxesQ.isError) {
    return <AsyncState variant="error">Failed to load roles and permissions.</AsyncState>;
  }

  return (
    <div className={s.page}>
      <div className={s.rolesLayout}>
        <aside className={s.rolesListCard}>
          <div className={s.rolesListHead}>
            <span>
              Roles <span className={s.rolesCountPill}>{roles.length}</span>
            </span>
            <Button size="sm" onClick={startCreate} prefixIcon={<Icon name="plus" size={13} />}>
              New role
            </Button>
          </div>
          <div className={s.rolesList}>
            {roles.map((role) => (
              <button
                key={role.id}
                type="button"
                className={`${s.roleListItem} ${activeId === role.id ? s.roleListItemActive : ''}`}
                onClick={() => setActiveId(role.id)}
              >
                <span className={s.roleListIcon}>
                  <Icon name={role.isSystem ? 'shield' : 'key'} size={14} />
                </span>
                <span className={s.roleListBody}>
                  <span className={s.roleListName}>{role.name}</span>
                  <span className={s.roleListMeta}>
                    {role.userCount} user{role.userCount !== 1 ? 's' : ''} ·{' '}
                    {role.permissions.length} permission{role.permissions.length !== 1 ? 's' : ''}
                  </span>
                </span>
                {role.isSystem && <span className={s.roleSystemPill}>System</span>}
              </button>
            ))}
          </div>
        </aside>

        <section className={s.roleEditorCard}>
          <div className={s.roleEditorHead}>
            <div>
              <div className={s.roleEditorKicker}>
                {isCreating ? 'Create role' : isSystemRole ? 'System role' : 'Custom role'}
              </div>
              <h3 className={s.roleEditorTitle}>
                {isCreating ? 'New custom role' : (activeRole?.name ?? 'Select a role')}
              </h3>
            </div>
            <div className={s.roleEditorHeadRight}>
              <span className={s.permTotalPill}>
                {draft.permissions.length} of {permissions.length} permissions
              </span>
              {activeRole && (
                <Label variant={roleTone(activeRole)} size="sm">
                  {SYSTEM_ROLE_LABEL[activeRole.baseRole] ?? activeRole.baseRole}
                </Label>
              )}
            </div>
          </div>

          {/* System roles are fixed: show what they are rather than blank,
              disabled inputs, which read as a broken form. */}
          {isSystemRole ? (
            <div className={s.roleLockedNote}>
              <Icon name="shield" size={14} />
              <span>
                <strong>{activeRole?.name}</strong> is a built-in role.
                {activeRole?.description ? ` ${activeRole.description}` : ''} Its permissions are
                fixed — create a custom role to define your own.
              </span>
            </div>
          ) : (
            <div className={s.roleFormGrid}>
              <label className={`${s.roleField} ${s.roleNameField}`}>
                <span>Name</span>
                <input
                  className={s.filterInput}
                  value={draft.name}
                  placeholder="e.g. Compliance Reviewer"
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  disabled={!canEdit}
                />
              </label>
              <label className={`${s.roleField} ${s.roleFieldWide}`}>
                <span>Description</span>
                <input
                  className={s.filterInput}
                  value={draft.description}
                  placeholder="What is this role for?"
                  onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                  disabled={!canEdit}
                />
              </label>
            </div>
          )}

          <div className={s.permissionBar}>
            <span className={s.permissionBarLabel}>Permissions</span>
            <button
              type="button"
              className={s.permissionBarBtn}
              onClick={() =>
                setCollapsedGroups((prev) =>
                  prev.size === permissionGroups.length
                    ? new Set()
                    : new Set(permissionGroups.map(([g]) => g)),
                )
              }
            >
              {collapsedGroups.size === permissionGroups.length ? 'Expand all' : 'Collapse all'}
            </button>
          </div>

          <div className={s.permissionMatrix}>
            {permissionColumns.map((column, columnIndex) => (
              <div className={s.permissionColumn} key={`permission-column-${columnIndex}`}>
                {column.map(([group, items]) => {
                  const onCount = items.filter((i) => draft.permissions.includes(i.id)).length;
                  const allOn = onCount === items.length;
                  const collapsed = collapsedGroups.has(group);
                  const bodyId = `perm-group-${group.replace(/\s+/g, '-').toLowerCase()}`;
                  return (
                    <div
                      className={`${s.permissionGroup} ${collapsed ? s.permissionGroupCollapsed : ''}`}
                      key={group}
                    >
                      {/* Header row is the accordion toggle. "Select all" can't be
                        nested inside it (button-in-button), so it sits alongside. */}
                      <div className={s.permissionGroupTitle}>
                        <button
                          type="button"
                          className={s.permGroupToggleBtn}
                          onClick={() => toggleGroupCollapse(group)}
                          aria-expanded={!collapsed}
                          aria-controls={bodyId}
                        >
                          <span className={s.permGroupChevron}>
                            <Icon name="chevR" size={13} />
                          </span>
                          <span className={s.permGroupName}>{group}</span>
                        </button>
                        <span
                          className={`${s.permGroupCount} ${onCount > 0 ? s.permGroupCountOn : ''}`}
                        >
                          {onCount}/{items.length}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            className={s.permGroupToggle}
                            onClick={() => toggleGroup(items)}
                          >
                            {allOn ? 'Clear' : 'Select all'}
                          </button>
                        )}
                      </div>
                      {!collapsed && (
                        <div className={s.permissionList} id={bodyId}>
                          {items.map((permission) => {
                            const checked = draft.permissions.includes(permission.id);
                            return (
                              <label
                                key={permission.id}
                                className={`${s.permissionItem} ${checked ? s.permissionItemOn : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  disabled={!canEdit}
                                  onChange={() => togglePermission(permission.id)}
                                />
                                <span className={s.permissionCheck}>
                                  {checked && <Icon name="check" size={12} />}
                                </span>
                                <span className={s.permissionText}>
                                  <span className={s.permissionName}>{permission.label}</span>
                                  <span className={s.permissionDesc}>{permission.description}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className={s.roleEditorActions}>
            {canEdit && (
              <span className={s.roleActionsHint}>
                {draft.permissions.length === 0
                  ? 'Select at least one permission to save.'
                  : `${draft.permissions.length} permission${draft.permissions.length === 1 ? '' : 's'} selected`}
              </span>
            )}
            {!isSystemRole && !isCreating && activeRole && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => deleteMut.mutate(activeRole.id)}
                loading={deleteMut.isPending}
                disabled={activeRole.userCount > 0}
              >
                Delete role
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => saveMut.mutate()}
              loading={saveMut.isPending}
              disabled={!canEdit || !draft.name.trim() || draft.permissions.length === 0}
            >
              {isCreating ? 'Create role' : 'Save changes'}
            </Button>
          </div>
        </section>
      </div>

      <section className={s.roleAssignCard}>
        {/* Title and the assign controls share one row — they were stacked
            before, which left a large empty gap above the table. */}
        <div className={s.roleAssignHead}>
          <div>
            <div className={s.roleEditorKicker}>User assignment</div>
            <h3 className={s.roleAssignTitle}>Assign roles to users</h3>
          </div>

          <div className={s.roleAssignBar}>
            <Combobox
              className={s.roleAssignCombo}
              options={userSelectOptions.map((item) => ({
                value: item.mailbox.id,
                label: item.name,
                sublabel: item.email,
                content: (
                  <UserCell
                    name={item.name}
                    secondary={item.secondary}
                    mailboxId={item.mailbox.id}
                    size={28}
                  />
                ),
              }))}
              value={selectedMailboxId}
              onChange={setSelectedMailboxId}
              placeholder="Select user"
            />
            <Combobox
              className={s.roleAssignCombo}
              options={assignableRoles.map((role) => ({
                value: role.id,
                label: role.name,
                sublabel: role.isSystem
                  ? 'System role'
                  : `${SYSTEM_ROLE_LABEL[role.baseRole]} base access`,
              }))}
              value={selectedAssignRole}
              onChange={setSelectedAssignRole}
              placeholder="Select role"
            />
            <Button
              size="sm"
              onClick={() => assignMut.mutate()}
              loading={assignMut.isPending}
              disabled={!selectedMailboxId || !selectedAssignRole}
            >
              Assign role
            </Button>
            {selectedMailboxId && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => unassignMut.mutate()}
                loading={unassignMut.isPending}
                disabled={!selectedHasAssignedRole}
              >
                Unassign role
              </Button>
            )}
          </div>
        </div>

        <div className={s.tableWrap}>
          <table className={s.tbl}>
            <thead>
              <tr>
                <th>User</th>
                <th>Assigned role</th>
                <th>Base access</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assignedMailboxUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className={s.roleEmptyCell}>
                    No assigned users found.
                  </td>
                </tr>
              ) : (
                assignedMailboxUsers.map((item) => (
                  <tr
                    key={item.mailbox.id}
                    onClick={() => setSelectedMailboxId(item.mailbox.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <UserCell
                        name={item.name}
                        secondary={item.email}
                        mailboxId={item.mailbox.id}
                        size={28}
                      />
                    </td>
                    <td className={s.subj}>{roleDisplayName(item.user)}</td>
                    <td>
                      <Label variant={item.user.role === Role.Admin ? 'warn' : 'ok'} size="sm">
                        {SYSTEM_ROLE_LABEL[item.user.role] ?? item.user.role}
                      </Label>
                    </td>
                    <td className={s.muted}>{item.user.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
