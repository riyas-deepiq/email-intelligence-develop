import { useQuery } from '@tanstack/react-query';
import { listAllMailboxes, type Mailbox } from '../mailboxes/mailboxes.api';
import { listUsers } from '../users/users.api';
import type { OrgGraph } from './org-hierarchy.api';
import { reachable } from './org-hierarchy.graph';

/** A read-only simulation; the server revalidates the complete graph at commit. */
export function ScopeChangePreview({
  before,
  after,
  mailboxAssignment,
}: {
  before: OrgGraph;
  after: OrgGraph;
  mailboxAssignment?: { nodeId: string; mailboxId: string };
}) {
  const people = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const mail = useQuery({ queryKey: ['mailboxes', 'all'], queryFn: listAllMailboxes });
  if (people.isError || mail.isError)
    return <p role="alert">Mailbox preview unavailable. Reload candidates before saving.</p>;
  if (!people.data || !mail.data) return <p>Loading complete mailbox access preview…</p>;
  let proposed = after;
  let proposedMailboxes = mail.data;
  const viewers: { id: string; displayName: string; status: string; role: string }[] = [
    ...people.data,
  ];
  if (mailboxAssignment) {
    const selected = mail.data.find((m) => m.id === mailboxAssignment.mailboxId);
    if (selected) {
      const existing = people.data.find(
        (u) =>
          u.id === selected.ownerUserId || u.email.toLowerCase() === selected.address.toLowerCase(),
      );
      const userId = existing?.id ?? 'preview:' + selected.id;
      if (!existing)
        viewers.push({
          id: userId,
          displayName: selected.displayName ?? selected.address,
          status: 'active',
          role: 'employee',
        });
      proposed = {
        ...after,
        nodes: after.nodes.map((n) => (n.id === mailboxAssignment.nodeId ? { ...n, userId } : n)),
      };
      proposedMailboxes = mail.data.map((m) =>
        m.id === selected.id ? { ...m, ownerUserId: userId } : m,
      );
    }
  }
  function scope(graph: OrgGraph, userId: string, boxes: Mailbox[]) {
    const asker = graph.nodes.find((n) => n.userId === userId);
    const positions = asker ? reachable(graph, asker.id) : new Set<string>();
    const owners = new Set([
      userId,
      ...graph.nodes.filter((n) => positions.has(n.id) && n.userId).map((n) => n.userId!),
    ]);
    return new Set(
      boxes
        .filter(
          (m) =>
            m.ownerUserId &&
            owners.has(m.ownerUserId) &&
            (m.ownerUserId === userId || !asker || m.orgId === asker.orgId),
        )
        .map((m) => m.id),
    );
  }
  const changes = viewers
    .filter((u) => u.status !== 'inactive' && u.role !== 'superadmin')
    .flatMap((u) => {
      const previous = scope(before, u.id, mail.data!),
        next = scope(proposed, u.id, proposedMailboxes);
      const added = mail.data!.filter((m) => next.has(m.id) && !previous.has(m.id));
      const removed = mail.data!.filter((m) => previous.has(m.id) && !next.has(m.id));
      return added.length || removed.length ? [{ u, previous, next, added, removed }] : [];
    });
  return (
    <details open>
      <summary>Before / after mailbox access</summary>
      {!changes.length && <p>No mailbox access changes for existing users.</p>}
      {changes.map(({ u, previous, next, added, removed }) => (
        <div key={u.id}>
          <strong>
            {u.displayName}: {previous.size} → {next.size} mailbox(es)
          </strong>
          {!!added.length && <p>Gains: {added.map((m) => m.address).join(', ')}</p>}
          {!!removed.length && <p>Loses: {removed.map((m) => m.address).join(', ')}</p>}
        </div>
      ))}
      <p>
        Based on current mailbox ownership. Deactivated accounts cannot log in, but their retained
        mailboxes remain in managers' scope. Super Admin's separate full-organization access is
        unchanged. Concurrent changes are revalidated on save.
      </p>
    </details>
  );
}
