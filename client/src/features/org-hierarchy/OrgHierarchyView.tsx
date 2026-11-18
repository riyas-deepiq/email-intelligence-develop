import { ScopeChangePreview } from './ScopeChangePreview';
import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { useToast } from '@/shared/toast/useToast';
import { listAllMailboxes } from '../mailboxes/mailboxes.api';
import { listUsers, createUserFromMailbox } from '../users/users.api';
import { getOrg, createOrg, updateOrg } from '../organizations/organizations.api';
import type { OrgRecord } from '../organizations/organizations.api';
import {
  addOrgNode,
  listOrgNodes,
  removeOrgNode,
  updateOrgNode,
  updateManagers,
  assignUser,
  getScope,
  type OrgGraph,
  type OrgNodeDto,
} from './org-hierarchy.api';
import { layoutConnectors, reachable, visibleGraph, layoutGraph } from './org-hierarchy.graph';
import { MailboxAvatar } from '../mailboxes/MailboxAvatar';
import { Avatar, Combobox, ColumnFilterMenu, Button, AsyncState } from '@/shared/components/ui';
import { Modal } from '@/shared/components/Modal';
import { useColumnPrefs, type ColumnMeta } from '@/shared/hooks/useColumnPrefs';
import styles from '@/styles/features/org-hierarchy/OrgHierarchyView.module.css';
import dashStyles from '@/styles/features/dashboard/pages/Dashboard.module.css';
const ORG_TABLE_COLUMNS: ColumnMeta[] = [
  { id: 'org', label: 'Organization' },
  { id: 'domain', label: 'Domain' },
  { id: 'admin', label: 'Admin Email' },
  { id: 'created', label: 'Created' },
  { id: 'actions', label: 'Actions', pinned: true },
];

// ─── Organizations section ────────────────────────────────────────────────────

function OrgFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: OrgRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [domains, setDomains] = useState(initial?.domains ?? '');
  const [adminEmail, setAdminEmail] = useState(initial?.adminEmail ?? '');

  const mut = useMutation({
    mutationFn: () =>
      initial ? updateOrg({ name, domains }) : createOrg({ name, domains, adminEmail }),
    onSuccess: () => {
      toast.success(initial ? 'Organization updated.' : 'Organization created.');
      onSaved();
      onClose();
    },
    onError: (e: unknown) => {
      const msg =
        (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Failed to save organization.';
      toast.error(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name && domains && (initial || adminEmail)) mut.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit Organization' : 'Create Organization'}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="org-form"
            loading={mut.isPending}
            disabled={!name || !domains || (!initial && !adminEmail)}
          >
            {initial ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <form id="org-form" onSubmit={handleSubmit} noValidate>
        <div className={dashStyles.formGroup}>
          <label className={dashStyles.formLabel}>Organization name *</label>
          <input
            className={dashStyles.formInput}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Corp"
            required
            autoFocus
          />
        </div>
        <div className={dashStyles.formGroup}>
          <label className={dashStyles.formLabel}>Domain(s) *</label>
          <input
            className={dashStyles.formInput}
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="acme.com, mail.acme.com"
            required
          />
        </div>
        {!initial && (
          <div className={dashStyles.formGroup}>
            <label className={dashStyles.formLabel}>Admin email *</label>
            <input
              type="email"
              className={dashStyles.formInput}
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@acme.com"
              required
            />
          </div>
        )}
      </form>
    </Modal>
  );
}

function OrganizationsSection() {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const {
    data: org,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['org'],
    queryFn: getOrg,
    retry: 1,
  });

  const isNotFound =
    isError && (error as { response?: { status?: number } })?.response?.status === 404;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['org'] });
    void qc.invalidateQueries({ queryKey: ['org-hierarchy'] });
  };
  const colPrefs = useColumnPrefs('org-hierarchy-orgs', ORG_TABLE_COLUMNS);

  function renderOrgTableCell(colId: string) {
    if (!org) return null;
    switch (colId) {
      case 'org':
        return (
          <td key={colId}>
            <div className={dashStyles.userCell}>
              <span className={dashStyles.miniAvatar}>{org.name.charAt(0).toUpperCase()}</span>
              {org.name}
            </div>
          </td>
        );
      case 'domain':
        return (
          <td key={colId} className={dashStyles.tdMuted}>
            {org.domains}
          </td>
        );
      case 'admin':
        return (
          <td key={colId} className={dashStyles.tdMuted}>
            {org.adminEmail}
          </td>
        );
      case 'created':
        return (
          <td key={colId} className={dashStyles.tdMuted}>
            {new Date(org.createdAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </td>
        );
      case 'actions':
        return (
          <td key={colId}>
            <button className={dashStyles.actionBtnPrimary} onClick={() => setEditing(true)}>
              Edit
            </button>
          </td>
        );
      default:
        return null;
    }
  }

  return (
    <section className={dashStyles.adminSection}>
      <div className={dashStyles.adminSectionHead}>
        <div>
          <h2 className={dashStyles.adminSectionTitle}>Organizations</h2>
          <p style={{ fontSize: '0.78rem', color: 'var(--d-text-dim)', marginTop: 2 }}>
            {org ? '1 organization' : '0 organizations'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ColumnFilterMenu prefs={colPrefs} />
          {(isNotFound || (!org && !isLoading && !isError)) && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              + Create organization
            </Button>
          )}
        </div>
      </div>

      <div className={dashStyles.tableWrap}>
        <table className={dashStyles.table}>
          <thead>
            <tr>
              {colPrefs.visible.map((col) => (
                <th key={col.id}>{col.id === 'actions' ? '' : col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={colPrefs.visible.length}
                  style={{ textAlign: 'center', color: 'var(--d-text-dim)', padding: '20px 0' }}
                >
                  Loading…
                </td>
              </tr>
            ) : isError && !isNotFound ? (
              <tr>
                <td
                  colSpan={colPrefs.visible.length}
                  style={{ textAlign: 'center', color: 'var(--color-danger)', padding: '20px 0' }}
                >
                  Failed to load organization.
                </td>
              </tr>
            ) : !org ? (
              <tr>
                <td
                  colSpan={colPrefs.visible.length}
                  style={{ textAlign: 'center', color: 'var(--d-text-dim)', padding: '28px 0' }}
                >
                  No organizations yet.
                </td>
              </tr>
            ) : (
              <tr>{colPrefs.visible.map((col) => renderOrgTableCell(col.id))}</tr>
            )}
          </tbody>
        </table>
      </div>

      {createOpen && <OrgFormModal onClose={() => setCreateOpen(false)} onSaved={invalidate} />}
      {editing && org && (
        <OrgFormModal initial={org} onClose={() => setEditing(false)} onSaved={invalidate} />
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.positionField}>
      <span>{label}</span>
      {children}
    </label>
  );
}
function errorMessage(e: unknown) {
  return (
    (e as { response?: { data?: { error?: { message?: string } } }; message?: string })?.response
      ?.data?.error?.message ??
    (e as { message?: string })?.message ??
    'Unable to save. Please try again.'
  );
}
function ManagerPicker({
  graph,
  nodeId,
  selected,
  onChange,
}: {
  graph: OrgGraph;
  nodeId?: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const excluded = nodeId ? reachable(graph, nodeId) : new Set<string>();
  const options = graph.nodes.filter((n) => !excluded.has(n.id));
  const term = query.trim().toLocaleLowerCase();
  const shown = options.filter((n) =>
    [n.user?.displayName, n.user?.email, n.title, n.department]
      .filter((value): value is string => !!value)
      .some((value) => value.toLocaleLowerCase().includes(term)),
  );
  return (
    <fieldset className={styles.managerPicker}>
      <legend>Reports to (select all direct managers)</legend>
      {!options.length && <p>This will be the root position.</p>}
      {!!options.length && (
        <>
          <label className={styles.managerSearch}>
            <span>Search reporting positions</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, position or department…"
            />
          </label>
          <div className={styles.managerOptions}>
            {!shown.length && <p>No matching positions.</p>}
            {shown.map((n) => (
              <label key={n.id} className={styles.managerOption}>
                <input
                  type="checkbox"
                  checked={selected.includes(n.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...selected, n.id]
                        : selected.filter((id) => id !== n.id),
                    )
                  }
                />
                <span>
                  <strong>{n.user?.displayName ?? 'Vacant'}</strong>
                  <small>
                    {n.title} · {n.department ?? 'No department'}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </>
      )}
      <p>Each selected manager receives access to the assigned users below this position.</p>
    </fieldset>
  );
}
function PositionEditor({
  graph,
  node,
  parent,
  onClose,
  onSaved,
}: {
  graph: OrgGraph;
  node?: OrgNodeDto;
  parent?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(node?.title ?? '');
  const [quantity, setQuantity] = useState(1);
  const initialManagers = graph.reportingLines
    .filter((e) => e.reportNodeId === node?.id)
    .map((e) => e.managerNodeId);
  const [managers, setManagers] = useState(node ? initialManagers : parent ? [parent] : []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mut = useMutation({
    mutationFn: async (action: 'details' | 'managers' | 'delete') => {
      if (!node) {
        let created = 0;
        for (; created < quantity; created++) {
          try {
            await addOrgNode({ title, managerNodeIds: managers });
          } catch (error) {
            if (!created) throw error;
            return {
              warning: true,
              message: `Created ${created} of ${quantity} positions. ${errorMessage(error)}`,
            };
          }
        }
        return {
          warning: false,
          message: created === 1 ? 'Position created.' : `${created} positions created.`,
        };
      }
      if (action === 'delete') await removeOrgNode(node.id);
      else if (action === 'managers') await updateManagers(node.id, managers);
      else await updateOrgNode(node.id, { title });
      return { warning: false, message: 'Hierarchy updated.' };
    },
    onSuccess: (result) => {
      onSaved();
      onClose();
      if (result.warning) toast.warning(result.message);
      else toast.success(result.message);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 25;
  const validRoot = managers.length > 0 || (!graph.nodes.length && quantity === 1);
  const hasChildren = graph.reportingLines.some((e) => e.managerNodeId === node?.id);
  const affected = node
    ? graph.nodes.filter((n) => n.user && reachable(graph, node.id).has(n.id))
    : [];
  return (
    <Modal
      open
      title={node ? 'Edit position' : 'Create position'}
      onClose={onClose}
      footer={
        <Button
          disabled={!title.trim() || mut.isPending || (!node && (!validQuantity || !validRoot))}
          onClick={() => mut.mutate('details')}
        >
          {node
            ? 'Save position'
            : quantity === 1
              ? 'Create position'
              : `Create ${quantity} positions`}
        </Button>
      }
    >
      <Field label="Position title">
        <input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      {!node && (
        <Field label="Number of positions">
          <input
            type="number"
            min={1}
            max={25}
            step={1}
            inputMode="numeric"
            aria-label="Number of positions"
            aria-describedby="position-quantity-help position-quantity-error"
            value={quantity || ''}
            onChange={(e) => setQuantity(e.currentTarget.valueAsNumber || 0)}
          />
          <small id="position-quantity-help">
            Create up to 25 separate vacant positions with the same title.
          </small>
          {!validQuantity && (
            <small id="position-quantity-error" role="alert">
              Enter a whole number from 1 to 25.
            </small>
          )}
        </Field>
      )}
      <ManagerPicker graph={graph} nodeId={node?.id} selected={managers} onChange={setManagers} />
      {!node && !validRoot && (
        <p role="alert">
          {graph.nodes.length
            ? 'Select at least one reporting position.'
            : 'Create one root position first, then add its reports.'}
        </p>
      )}
      {node && (
        <>
          <p>
            Reporting changes affect {affected.length} assigned user(s) in this branch. Existing
            alternate paths remain valid.
          </p>
          <ScopeChangePreview
            before={graph}
            after={{
              ...graph,
              reportingLines: [
                ...graph.reportingLines.filter((e) => e.reportNodeId !== node.id),
                ...managers.map((id) => ({ managerNodeId: id, reportNodeId: node.id })),
              ],
            }}
          />
          <Button disabled={mut.isPending} onClick={() => mut.mutate('managers')}>
            Save reporting lines
          </Button>
          <hr />
          {hasChildren ? (
            <p>Move or remove child reporting lines before deleting this position.</p>
          ) : (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmDelete}
                  onChange={(e) => setConfirmDelete(e.target.checked)}
                />
                Confirm position deletion (user account is preserved)
              </label>
              <Button
                variant="danger"
                disabled={!confirmDelete || mut.isPending}
                onClick={() => mut.mutate('delete')}
              >
                Delete position
              </Button>
            </>
          )}
        </>
      )}
      {mut.isError && <p role="alert">{errorMessage(mut.error)}</p>}
    </Modal>
  );
}

function AssignmentEditor({
  graph,
  node,
  onClose,
  onSaved,
}: {
  graph: OrgGraph;
  node: OrgNodeDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const people = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const mail = useQuery({ queryKey: ['mailboxes', 'all'], queryFn: listAllMailboxes });
  const [selected, setSelected] = useState(node.userId ? 'user:' + node.userId : '');
  const [confirm, setConfirm] = useState(false);
  const ready = people.isSuccess && mail.isSuccess;
  const assigned = new Set(
    graph.nodes.filter((n) => n.id !== node.id && n.userId).map((n) => n.userId),
  );
  const addresses = new Set(
    graph.nodes.filter((n) => n.id !== node.id && n.user).map((n) => n.user!.email.toLowerCase()),
  );
  const options: { value: string; label: string; sublabel: string }[] = [];
  const seen = new Set<string>();
  for (const u of people.data ?? []) {
    const email = u.email.toLowerCase();
    if (assigned.has(u.id) || addresses.has(email) || seen.has(email) || u.status === 'inactive')
      continue;
    seen.add(email);
    options.push({ value: 'user:' + u.id, label: u.displayName, sublabel: email });
  }
  for (const m of mail.data ?? []) {
    const email = m.address.toLowerCase();
    if (
      seen.has(email) ||
      addresses.has(email) ||
      (m.ownerUserId &&
        (assigned.has(m.ownerUserId) ||
          people.data?.some((u) => u.id === m.ownerUserId && u.status === 'inactive')))
    )
      continue;
    seen.add(email);
    options.push({ value: 'mailbox:' + m.id, label: m.displayName ?? email, sublabel: email });
  }
  const mutation = useMutation({
    mutationFn: async (unassign: boolean) => {
      let userId: string | null = null;
      if (!unassign) {
        const [kind, id] = selected.split(':');
        userId = kind === 'mailbox' ? (await createUserFromMailbox(id)).id : id;
      }
      return assignUser(node.id, userId);
    },
    onSuccess: () => {
      onSaved();
      onClose();
      toast.success('Assignment saved.');
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['users'] });
      void qc.invalidateQueries({ queryKey: ['mailboxes'] });
    },
  });
  return (
    <Modal
      open
      title={'Assign user — ' + node.title}
      onClose={onClose}
      footer={
        <Button
          disabled={!ready || !selected || !confirm || mutation.isPending}
          onClick={() => mutation.mutate(false)}
        >
          Assign selected user
        </Button>
      }
    >
      <p>
        One user occupies one position. To move a user, unassign their old position first; positions
        and reporting lines remain intact.
      </p>
      {people.isError || mail.isError ? (
        <AsyncState variant="error">Could not load all candidates. Reopen to retry.</AsyncState>
      ) : people.isLoading || mail.isLoading ? (
        <AsyncState variant="loading">Loading users and all mailbox pages…</AsyncState>
      ) : (
        <Combobox
          options={options}
          value={selected}
          onChange={setSelected}
          placeholder="Select user or mailbox…"
        />
      )}
      {ready && selected.startsWith('user:') && (
        <ScopeChangePreview
          before={graph}
          after={{
            ...graph,
            nodes: graph.nodes.map((n) =>
              n.id === node.id ? { ...n, userId: selected.slice(5) } : n,
            ),
          }}
        />
      )}
      {ready && selected.startsWith('mailbox:') && (
        <ScopeChangePreview
          before={graph}
          after={graph}
          mailboxAssignment={{ nodeId: node.id, mailboxId: selected.slice(8) }}
        />
      )}
      {node.userId && (
        <details>
          <summary>Preview unassignment</summary>
          <ScopeChangePreview
            before={graph}
            after={{
              ...graph,
              nodes: graph.nodes.map((n) =>
                n.id === node.id ? { ...n, userId: null, user: null } : n,
              ),
            }}
          />
        </details>
      )}
      <label>
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
        Confirm this change to reporting access
      </label>
      {node.userId && (
        <Button
          variant="danger"
          disabled={!confirm || mutation.isPending}
          onClick={() => mutation.mutate(true)}
        >
          Unassign user; keep position
        </Button>
      )}
      {mutation.isError && <p role="alert">{errorMessage(mutation.error)}</p>}
    </Modal>
  );
}

function ScopeDialog({ node, onClose }: { node: OrgNodeDto; onClose: () => void }) {
  const mail = useQuery({ queryKey: ['mailboxes', 'all'], queryFn: listAllMailboxes });
  const scope = useQuery({
    queryKey: ['org-scope', node.userId],
    queryFn: () => getScope(node.userId!),
  });
  return (
    <Modal open title={'Effective mailbox access — ' + node.user?.displayName} onClose={onClose}>
      {scope.isLoading ? (
        <AsyncState variant="loading">Resolving access…</AsyncState>
      ) : scope.isError ? (
        <AsyncState variant="error">Could not resolve scope.</AsyncState>
      ) : (
        <>
          <p>{scope.data?.mailboxIds.length} distinct mailbox(es) through reporting positions.</p>
          <details>
            <summary>Included mailboxes</summary>
            <ul>
              {scope.data?.mailboxIds.map((id) => (
                <li key={id}>{mail.data?.find((m) => m.id === id)?.address ?? id}</li>
              ))}
            </ul>
          </details>
          {node.user?.role === 'superadmin' && (
            <p>This is hierarchy scope. Super Admin separately has full organization access.</p>
          )}
          <ul>
            {scope.data?.nodes.map((n) => (
              <li key={n.id}>
                {n.title} — {n.user?.displayName ?? 'Vacant'}
              </li>
            ))}
          </ul>
          <details>
            <summary>All granting reporting lines</summary>
            <ul>
              {scope.data?.reportingLines.map((e) => (
                <li key={e.managerNodeId + e.reportNodeId}>
                  {scope.data?.nodes.find((n) => n.id === e.managerNodeId)?.title}
                  {' → '}
                  {scope.data?.nodes.find((n) => n.id === e.reportNodeId)?.title}
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </Modal>
  );
}

export function OrgHierarchyView() {
  const { user } = useAuth();
  const canEdit = user?.role === 'superadmin';
  const qc = useQueryClient();
  const result = useQuery({ queryKey: ['org-hierarchy'], queryFn: listOrgNodes });
  const mail = useQuery({
    queryKey: ['mailboxes', 'all'],
    queryFn: listAllMailboxes,
    enabled: canEdit,
  });
  const graph = result.data ?? { nodes: [], reportingLines: [] };
  const [department, setDepartment] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [mode, setMode] = useState<'chart' | 'list'>('chart');
  const [editor, setEditor] = useState<{ node?: OrgNodeDto; parent?: string } | null>(null);
  const [assignment, setAssignment] = useState<OrgNodeDto | null>(null);
  const [preview, setPreview] = useState<OrgNodeDto | null>(null);
  const shown = visibleGraph(graph, collapsed, department);
  const layout = layoutGraph(shown);
  const connectors = layoutConnectors(shown, layout);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['org-hierarchy'] });
    void qc.invalidateQueries({ queryKey: ['org-scope'] });
    // Hierarchy changes alter every mailbox-backed view's data authorization.
    void qc.invalidateQueries();
  };
  const changeZoom = (requested: number, clientX?: number, clientY?: number) => {
    const viewport = viewportRef.current;
    const next = Math.min(2, Math.max(0.5, requested));
    if (!viewport || next === zoom) return;
    const rect = viewport.getBoundingClientRect();
    const offsetX = (clientX ?? rect.left + viewport.clientWidth / 2) - rect.left;
    const offsetY = (clientY ?? rect.top + viewport.clientHeight / 2) - rect.top;
    const graphX = (viewport.scrollLeft + offsetX) / zoom;
    const graphY = (viewport.scrollTop + offsetY) / zoom;
    setZoom(next);
    requestAnimationFrame(() => {
      viewport.scrollLeft = graphX * next - offsetX;
      viewport.scrollTop = graphY * next - offsetY;
    });
  };
  const startPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest('button, input, select, a, label'))
    )
      return;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setPanning(true);
  };
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
    event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
  };
  const stopPan = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPanning(false);
  };
  const departments = [
    ...new Set(graph.nodes.map((n) => n.department).filter((d): d is string => !!d)),
  ].sort();
  const card = (node: OrgNodeDto) => {
    const parents = graph.reportingLines
      .filter((e) => e.reportNodeId === node.id)
      .map((e) => graph.nodes.find((n) => n.id === e.managerNodeId))
      .filter((manager): manager is OrgNodeDto => !!manager)
      .sort(
        (a, b) =>
          a.sortOrder - b.sortOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
      )
      .map((manager) => manager.title);
    const mailbox = mail.data?.find((m) => m.ownerUserId === node.userId && node.userId);
    const hasChildren = graph.reportingLines.some((e) => e.managerNodeId === node.id);
    return (
      <>
        <div className={styles.positionAvatar}>
          {node.user ? (
            mailbox ? (
              <MailboxAvatar
                mailboxId={mailbox.id}
                name={node.user.displayName}
                size={52}
                fallbackBg="#64748b"
              />
            ) : (
              <Avatar name={node.user.displayName} size={52} />
            )
          ) : (
            <Avatar name={node.title} size={52} />
          )}
        </div>
        <span className={node.user ? styles.assignedBadge : styles.vacantBadge}>
          {node.user ? 'Assigned' : 'Vacant'}
        </span>
        <div className={styles.positionDetails}>
          <h3 title={node.title}>{node.title}</h3>
          <strong className={styles.positionPerson} title={node.user?.displayName}>
            {node.user?.displayName ?? 'Open position'}
          </strong>
          <small className={styles.positionEmail} title={node.user?.email}>
            {node.user?.email ?? 'Ready for assignment'}
          </small>
          <span className={styles.positionMeta}>
            {node.department ?? 'No department'}
            {node.user && <small>{node.user.roleName ?? node.user.role}</small>}
          </span>
          <small className={styles.reportingText} title={parents.join(', ')}>
            Reports to: {parents.join(', ') || 'Root'}
          </small>
        </div>
        <div className={styles.positionActions}>
          {hasChildren && (
            <button
              type="button"
              aria-expanded={!collapsed.has(node.id)}
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(node.id)) next.delete(node.id);
                  else next.add(node.id);
                  return next;
                })
              }
            >
              {collapsed.has(node.id) ? 'Expand' : 'Collapse'}
            </button>
          )}
          {canEdit && (
            <>
              <button type="button" onClick={() => setEditor({ parent: node.id })}>
                Add report
              </button>
              <button type="button" onClick={() => setEditor({ node })}>Edit</button>
              <button type="button" onClick={() => setAssignment(node)}>
                {node.user ? 'Assignment' : 'Assign user'}
              </button>
              {node.user && (
                <button
                  type="button"
                  aria-label="Access preview"
                  onClick={() => setPreview(node)}
                >
                  Access
                </button>
              )}
            </>
          )}
        </div>
      </>
    );
  };
  return (
    <div className={dashStyles.adminPage}>
      <OrganizationsSection />
      <section className={dashStyles.adminSection}>
        <div className={styles.positionToolbar}>
          <div className={styles.positionHeading}>
            <div>
              <span className={styles.eyebrow}>Reporting structure</span>
              <h2>Organization hierarchy</h2>
            </div>
            <p>
              <strong>{graph.nodes.length}</strong> positions
              <span aria-hidden="true"> · </span>
              <strong>{graph.nodes.filter((n) => !n.user).length}</strong> vacant
            </p>
          </div>
          <div className={styles.positionControls}>
            <label className={styles.departmentFilter}>
              <span>Department</span>
            <select
              aria-label="Department filter"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            </label>
            <div className={styles.viewSwitch} role="group" aria-label="Hierarchy view">
              <button
                type="button"
                aria-label="Chart view"
                aria-pressed={mode === 'chart'}
                onClick={() => setMode('chart')}
              >
                Chart
              </button>
              <button
                type="button"
                aria-label="List view"
                aria-pressed={mode === 'list'}
                onClick={() => setMode('list')}
              >
                List
              </button>
            </div>
            <div className={styles.zoomControls} role="group" aria-label="Chart zoom">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => changeZoom(zoom - 0.25)}
              >
                −
              </button>
              <button
                type="button"
                aria-label="Reset zoom to 100%"
                onClick={() => changeZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoom >= 2}
                onClick={() => changeZoom(zoom + 0.25)}
              >
                +
              </button>
            </div>
            <button
              type="button"
              className={styles.expandButton}
              disabled={!collapsed.size}
              onClick={() => setCollapsed(new Set())}
            >
              Expand all
            </button>
            {canEdit && !!graph.nodes.length && (
              <Button
                size="sm"
                className={styles.createPositionButton}
                onClick={() => setEditor({})}
              >
                Create position
              </Button>
            )}
          </div>
        </div>
        {result.isLoading && <AsyncState variant="loading">Loading hierarchy…</AsyncState>}
        {result.isError && (
          <AsyncState variant="error">
            Could not load hierarchy. Create an organization if needed.
            <button onClick={() => result.refetch()}>Retry</button>
          </AsyncState>
        )}
        {!result.isLoading && !result.isError && !graph.nodes.length && (
          <>
            <p>Design positions first, connect their managers, then assign users.</p>
            {canEdit && <Button onClick={() => setEditor({})}>Create position</Button>}
          </>
        )}
        {!!graph.nodes.length && !shown.nodes.length && <p>No positions match this department.</p>}
        {mode === 'chart' && !!shown.nodes.length && (
          <div
            ref={viewportRef}
            className={styles.graphViewport}
            role="region"
            aria-label="Organization chart. Drag blank space to pan; use the mouse wheel or zoom controls to zoom."
            tabIndex={0}
            data-panning={panning}
            onPointerDown={startPan}
            onPointerMove={movePan}
            onPointerUp={stopPan}
            onPointerCancel={stopPan}
            onWheelCapture={(event) => {
              event.preventDefault();
              changeZoom(zoom + (event.deltaY < 0 ? 0.1 : -0.1), event.clientX, event.clientY);
            }}
          >
            <div
              className={styles.graphCanvas}
              style={{ width: layout.width * zoom, height: layout.height * zoom }}
            >
              <div
                className={styles.graphContent}
                style={{
                  width: layout.width,
                  height: layout.height,
                  transform: `scale(${zoom})`,
                }}
              >
                <svg
                  className={styles.graphEdges}
                  width={layout.width}
                  height={layout.height}
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient id="org-edge-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop className={styles.edgeStart} offset="0%" />
                      <stop className={styles.edgeEnd} offset="100%" />
                    </linearGradient>
                  </defs>
                  {connectors.map((connector) => {
                    return (
                      <React.Fragment key={connector.key}>
                        <path d={connector.d} />
                        {connector.endpoints.map((point) => (
                          <circle key={point.x + ':' + point.y} cx={point.x} cy={point.y} r="3" />
                        ))}
                      </React.Fragment>
                    );
                  })}
                </svg>
                {shown.nodes.map((n) => (
                  <article
                    key={n.id}
                    className={styles.positionCard}
                    style={{
                      left: layout.positions.get(n.id)!.x,
                      top: layout.positions.get(n.id)!.y,
                      width: layout.cardWidth,
                      height: layout.cardHeight,
                    }}
                    aria-label={n.title}
                  >
                    {card(n)}
                  </article>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className={mode === 'chart' ? styles.mobilePositionList : styles.positionList}>
          {[...shown.nodes]
            .sort((a, b) => {
              const first = layout.positions.get(a.id)!,
                second = layout.positions.get(b.id)!;
              return first.y - second.y || first.x - second.x;
            })
            .map((n) => (
              <article key={n.id} className={styles.positionListCard} aria-label={n.title}>
                {card(n)}
              </article>
            ))}
        </div>
      </section>
      {editor && (
        <PositionEditor
          graph={graph}
          {...editor}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setCollapsed(new Set());
            invalidate();
          }}
        />
      )}
      {assignment && (
        <AssignmentEditor
          graph={graph}
          node={assignment}
          onClose={() => setAssignment(null)}
          onSaved={invalidate}
        />
      )}
      {preview && <ScopeDialog node={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
