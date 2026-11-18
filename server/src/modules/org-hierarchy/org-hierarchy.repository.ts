import { sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { getDb } from '../../db/client';
import { auditLog } from '../../db/schema';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import type { AuditActor, WriteAuditInput } from '../audit/audit.types';
import { createAuditRepository } from '../audit/audit.repository';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';
import { sharedMemoryMailboxRepo } from '../mailboxes/mailbox.repository';
import { isEmailDomainAllowed } from '../organizations/org-domains';
import type { OrgRepository } from '../organizations/org.repository';
import { sharedMemoryOrgRepo } from '../organizations/org.repository';
import type { UserRepository } from '../users/user.repository';
import { sharedMemoryRepo } from '../users/user.repository';
import { sharedMemoryRoleRepo } from '../roles/role.repository';
import { applyCommand, descendants } from './org-hierarchy.graph';
import type { HierarchyCommand, OrgGraph, OrgHierarchyRepository } from './org-hierarchy.types';
export type { OrgHierarchyRepository } from './org-hierarchy.types';

type Database = Pick<ReturnType<typeof getDb>, 'execute'>;

function eventFor(
  before: OrgGraph,
  after: OrgGraph,
  c: HierarchyCommand,
  actor: AuditActor,
): WriteAuditInput {
  const snapshot = (g: OrgGraph): Record<string, unknown> | null => {
    const node = g.nodes.find((n) => n.id === c.nodeId);
    return node
      ? { ...node, managers: g.reportingLines.filter((e) => e.reportNodeId === c.nodeId) }
      : null;
  };
  return {
    actor,
    entityType: 'org_hierarchy',
    entityId: c.nodeId,
    eventType:
      c.type === 'create'
        ? 'org_hierarchy.node_added'
        : c.type === 'delete'
          ? 'org_hierarchy.node_removed'
          : 'org_hierarchy.node_updated',
    oldValue: snapshot(before),
    newValue: { operation: c.type, position: snapshot(after) },
  };
}

async function readGraph(db: Database, orgId: string): Promise<OrgGraph> {
  const result = await db.execute<{ graph: OrgGraph }>(sql`
    SELECT json_build_object(
      'nodes', COALESCE((
        SELECT json_agg(node ORDER BY node."sortOrder", node.id) FROM (
          SELECT n.id, n.org_id AS "orgId", n.user_id AS "userId", n.title, n.department,
            n.sort_order AS "sortOrder", n.created_at AS "createdAt", n.updated_at AS "updatedAt",
            CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
              'id', u.id, 'email', u.email, 'displayName', u.display_name,
              'role', u.role, 'roleName', r.name
            ) END AS "user"
          FROM org_nodes n LEFT JOIN users u ON u.id = n.user_id
          LEFT JOIN roles r ON r.id = u.role_id WHERE n.org_id = ${orgId}
        ) node
      ), '[]'::json),
      'reportingLines', COALESCE((
        SELECT json_agg(json_build_object('managerNodeId', manager_node_id, 'reportNodeId', report_node_id)
          ORDER BY manager_node_id, report_node_id)
        FROM org_reporting_lines WHERE org_id = ${orgId}
      ), '[]'::json)
    ) AS graph
  `);
  return result.rows[0].graph;
}

export class PgOrgHierarchyRepository implements OrgHierarchyRepository {
  getGraph(orgId: string): Promise<OrgGraph> {
    return readGraph(getDb(), orgId);
  }

  async mutate(orgId: string, c: HierarchyCommand, actor?: AuditActor): Promise<OrgGraph> {
    try {
      return await getDb().transaction(async (tx) => {
        // ponytail: serialize hierarchy writers; per-org locks can replace this if contention is measured.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('insight-hub:org-hierarchy'))`);
        const org = await tx.execute<{ domains: string; admin_email: string }>(
          sql`SELECT domains, admin_email FROM organizations WHERE id = ${orgId} FOR SHARE`,
        );
        if (!org.rows[0]) throw new NotFoundError('Organization not found');
        const before = await readGraph(tx, orgId);
        const after = applyCommand(before, orgId, c);
        const changed = after.nodes.find((n) => n.id === c.nodeId);
        if ((c.type === 'assignment' || c.type === 'create') && changed?.userId) {
          const user = await tx.execute<{ email: string; status: string }>(
            sql`SELECT email, status FROM users WHERE id = ${changed.userId} FOR UPDATE`,
          );
          if (!user.rows[0]) throw new NotFoundError('User not found');
          if (user.rows[0].status === 'inactive')
            throw new ValidationError('Cannot assign an inactive user');
          const owned = await tx.execute<{ org_id: string }>(
            sql`SELECT org_id FROM mailboxes WHERE owner_user_id = ${changed.userId}`,
          );
          const belongs =
            owned.rows.some((m) => m.org_id === orgId) ||
            isEmailDomainAllowed(user.rows[0].email, org.rows[0].domains) ||
            user.rows[0].email.toLowerCase() === org.rows[0].admin_email.toLowerCase();
          if (!belongs || owned.rows.some((m) => m.org_id !== orgId)) {
            throw new ValidationError('User and mailboxes must belong to this organization');
          }
        }
        if (c.type === 'delete') {
          await tx.execute(sql`DELETE FROM org_nodes WHERE id = ${c.nodeId} AND org_id = ${orgId}`);
        } else if (changed) {
          await tx.execute(sql`
            INSERT INTO org_nodes (id, org_id, user_id, title, department, sort_order)
            VALUES (${changed.id}, ${orgId}, ${changed.userId}, ${changed.title}, ${changed.department}, ${changed.sortOrder})
            ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, title = EXCLUDED.title,
              department = EXCLUDED.department, sort_order = EXCLUDED.sort_order, updated_at = now()
          `);
        }
        if (c.type === 'create' || c.type === 'managers' || c.type === 'delete') {
          await tx.execute(sql`DELETE FROM org_reporting_lines WHERE report_node_id = ${c.nodeId}`);
          for (const e of after.reportingLines.filter((e) => e.reportNodeId === c.nodeId)) {
            await tx.execute(sql`INSERT INTO org_reporting_lines (org_id, manager_node_id, report_node_id)
              VALUES (${orgId}, ${e.managerNodeId}, ${e.reportNodeId})`);
          }
          await tx.execute(sql`SELECT rebuild_org_closure(${orgId}::uuid)`);
        }
        const result = await readGraph(tx, orgId);
        if (actor) {
          const event = eventFor(before, result, c, actor);
          await tx.insert(auditLog).values({
            ...event.actor,
            actorId: actor.actorId,
            entityType: event.entityType,
            entityId: event.entityId,
            eventType: event.eventType,
            oldValue: event.oldValue,
            newValue: event.newValue,
          });
        }
        return result;
      });
    } catch (error) {
      // Drizzle may wrap the PostgreSQL constraint failure.
      const e = error as { code?: string; cause?: { code?: string } };
      if ((e.code ?? e.cause?.code) === '23505')
        throw new ConflictError('User already occupies another position');
      throw error;
    }
  }

  async getAllowedMailboxIds(userId: string): Promise<string[]> {
    const r = await getDb().execute<{ id: string }>(sql`
      SELECT DISTINCT m.id FROM mailboxes m
      WHERE (
        m.owner_user_id = ${userId}
        OR EXISTS (
          SELECT 1 FROM org_nodes asker
          JOIN org_closure c ON c.ancestor_node_id = asker.id
          JOIN org_nodes report ON report.id = c.descendant_node_id
          WHERE asker.user_id = ${userId} AND report.user_id = m.owner_user_id
            AND asker.org_id = report.org_id AND m.org_id = asker.org_id
        )
      ) ORDER BY m.id
    `);
    return r.rows.map((m) => m.id);
  }
}

export class InMemoryOrgHierarchyRepository implements OrgHierarchyRepository {
  private graph: OrgGraph = { nodes: [], reportingLines: [] };
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly mailboxRepo?: MailboxRepository,
    private readonly userRepo?: UserRepository,
    private readonly orgRepo?: OrgRepository,
  ) {}

  async getGraph(orgId: string): Promise<OrgGraph> {
    const nodes = await Promise.all(
      this.graph.nodes
        .filter((n) => n.orgId === orgId)
        .map(async (n) => {
          const user = n.userId ? await this.userRepo?.findById(n.userId) : null;
          const role = user?.roleId ? await sharedMemoryRoleRepo.findById(user.roleId) : null;
          // Mirror ON DELETE SET NULL, including a user removed through the user repository.
          return {
            ...n,
            userId: user ? n.userId : null,
            user: user
              ? {
                  id: user.id,
                  email: user.email,
                  displayName: user.displayName,
                  role: user.role,
                  roleName: role?.name ?? user.roleName,
                }
              : null,
          };
        }),
    );
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const ids = new Set(nodes.map((n) => n.id));
    return structuredClone({
      nodes,
      reportingLines: this.graph.reportingLines.filter((e) => ids.has(e.managerNodeId)),
    });
  }

  mutate(orgId: string, c: HierarchyCommand, actor?: AuditActor): Promise<OrgGraph> {
    const action = this.pending.then(async () => {
      const before = await this.getGraph(orgId);
      const after = applyCommand(before, orgId, c);
      const changed = after.nodes.find((n) => n.id === c.nodeId);
      if ((c.type === 'assignment' || c.type === 'create') && changed?.userId) {
        const user = await this.userRepo?.findById(changed.userId);
        if (!user) throw new NotFoundError('User not found');
        if (user.status === 'inactive') throw new ValidationError('Cannot assign an inactive user');
        for (const other of this.graph.nodes.filter((n) => n.orgId !== orgId)) {
          if (other.userId === changed.userId)
            throw new ConflictError('User already occupies another position');
        }
        const boxes = (await this.mailboxRepo?.findAll({ limit: 2147483647 })) ?? [];
        const owned = boxes.filter((m) => m.ownerUserId === changed.userId);
        const org = await this.orgRepo?.findFirst();
        if (
          owned.some((m) => m.orgId !== orgId) ||
          (org &&
            (org.id !== orgId ||
              (!owned.length &&
                !isEmailDomainAllowed(user.email, org.domains) &&
                user.email.toLowerCase() !== org.adminEmail.toLowerCase())))
        ) {
          throw new ValidationError('User and mailboxes must belong to this organization');
        }
      }
      if (actor) await createAuditRepository().write(eventFor(before, after, c, actor));
      const oldIds = new Set(before.nodes.map((n) => n.id));
      this.graph = {
        nodes: [...this.graph.nodes.filter((n) => n.orgId !== orgId), ...after.nodes],
        reportingLines: [
          ...this.graph.reportingLines.filter((e) => !oldIds.has(e.managerNodeId)),
          ...after.reportingLines,
        ],
      };
      return this.getGraph(orgId);
    });
    this.pending = action.catch(() => undefined);
    return action;
  }

  async getAllowedMailboxIds(userId: string): Promise<string[]> {
    const owners = new Set([userId]);
    const asker = this.graph.nodes.find((n) => n.userId === userId);
    const graph = asker ? await this.getGraph(asker.orgId) : null;
    if (graph) {
      const reachable = descendants(graph, asker!.id);
      for (const n of graph.nodes) if (n.userId && reachable.has(n.id)) owners.add(n.userId);
    }
    const existingOwners = new Set<string>();
    for (const owner of owners) {
      const user = await this.userRepo?.findById(owner);
      if (user) existingOwners.add(owner);
    }
    const boxes = (await this.mailboxRepo?.findAll({ limit: 2147483647 })) ?? [];
    return [
      ...new Set(
        boxes
          .filter(
            (m) =>
              m.ownerUserId &&
              existingOwners.has(m.ownerUserId) &&
              (m.ownerUserId === userId || !asker || m.orgId === asker.orgId),
          )
          .map((m) => m.id),
      ),
    ].sort();
  }
}

export const sharedMemoryOrgHierarchyRepo = new InMemoryOrgHierarchyRepository(
  sharedMemoryMailboxRepo,
  sharedMemoryRepo,
  sharedMemoryOrgRepo,
);
export function createOrgHierarchyRepository(): OrgHierarchyRepository {
  return config.env === 'test' || config.database.driver === 'memory'
    ? sharedMemoryOrgHierarchyRepo
    : new PgOrgHierarchyRepository();
}
