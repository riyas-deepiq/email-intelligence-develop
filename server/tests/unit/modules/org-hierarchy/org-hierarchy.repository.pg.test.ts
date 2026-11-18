import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../../../../src/config/env';
import { closeDb, getDb } from '../../../../src/db/client';
import { organizations, users, mailboxes, orgClosure, roles } from '../../../../src/db/schema';
import { descendants } from '../../../../src/modules/org-hierarchy/org-hierarchy.graph';
import { PgOrgHierarchyRepository } from '../../../../src/modules/org-hierarchy/org-hierarchy.repository';

const enabled = process.env.RUN_PG_INTEGRATION === '1';
describe.skipIf(!enabled)('dedicated PostgreSQL migration and graph contract', () => {
  const repo = new PgOrgHierarchyRepository();
  const ids = Array.from({ length: 9 }, () => randomUUID());
  const owners = Array.from({ length: 9 }, () => randomUUID());
  const names = ['Chairman', 'CEO', 'CTO', 'Manager1', 'Manager2', 'E1', 'E2', 'E3', 'E4'];
  const parents: number[][] = [[], [0], [0], [1, 2], [1, 2], [3], [3], [4], [4]];
  const orgId = randomUUID(),
    legacyOrg = randomUUID();
  const legacyUsers = [randomUUID(), randomUUID(), randomUUID()];
  let client: Client;
  const actor = {
    actorId: null,
    actorEmail: 'test@hierarchy.test',
    actorRole: 'superadmin',
    ipAddress: '127.0.0.1',
  };
  const command = (index: number, managerIndexes: number[]): ReturnType<typeof repo.mutate> =>
    repo.mutate(
      orgId,
      { type: 'managers', nodeId: ids[index], managerNodeIds: managerIndexes.map((i) => ids[i]) },
      actor,
    );
  beforeAll(async () => {
    const url = process.env.HIERARCHY_TEST_DATABASE_URL;
    if (!url || !/^hierarchy_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1)))
      throw new Error(
        'Use a NEW dedicated hierarchy_test_* database via HIERARCHY_TEST_DATABASE_URL',
      );
    config.database.url = url;
    client = new Client({ connectionString: url });
    await client.connect();
    const existing = await client.query(
      "SELECT 1 FROM information_schema.tables WHERE table_schema='public' LIMIT 1",
    );
    if (existing.rowCount)
      throw new Error('Refusing non-empty test database; create a fresh hierarchy_test_* database');
    const folder = path.resolve('drizzle');
    const journal = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number; tag: string }[];
    };
    await client.query('BEGIN');
    try {
      for (const entry of journal.entries.filter((e) => e.idx < 21))
        await client.query(readFileSync(path.join(folder, entry.tag + '.sql'), 'utf8'));
      await client.query(
        'INSERT INTO organizations(id,name,domains,admin_email) VALUES($1,$2,$3,$4)',
        [legacyOrg, 'Legacy', 'hierarchy.test', 'admin@hierarchy.test'],
      );
      for (let i = 0; i < 3; i++) {
        await client.query('INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)', [
          legacyUsers[i],
          'legacy' + i + '@hierarchy.test',
          'Legacy ' + i,
        ]);
        await client.query(
          'INSERT INTO org_nodes(org_id,user_id,manager_id,title) VALUES($1,$2,$3,$4)',
          [legacyOrg, legacyUsers[i], i === 1 ? legacyUsers[0] : null, i === 0 ? null : 'Legacy'],
        );
        await client.query('INSERT INTO org_closure(ancestor,descendant,depth) VALUES($1,$1,0)', [
          legacyUsers[i],
        ]);
        await client.query(
          'INSERT INTO mailboxes(org_id,owner_user_id,address,provider) VALUES($1,$2,$3,$4)',
          [legacyOrg, legacyUsers[i], 'legacy' + i + '@hierarchy.test', 'm365'],
        );
      }
      await client.query('INSERT INTO org_closure(ancestor,descendant,depth) VALUES($1,$2,1)', [
        legacyUsers[0],
        legacyUsers[1],
      ]);
      // This legacy forest must acquire one vacant root without granting either root access to the other.
      const diagnostics = readFileSync(path.resolve('scripts/check-org-hierarchy.sql'), 'utf8');
      // Already inside the migration rehearsal transaction; execute only its read-only queries.
      await client.query(diagnostics.replace('BEGIN READ ONLY;', '').replace('COMMIT;', ''));
      const migration = readFileSync(path.join(folder, '0021_org_hierarchy_positions.sql'), 'utf8');
      await client.query('SAVEPOINT corrupt_test');
      await client.query('DELETE FROM org_closure WHERE ancestor<>descendant');
      await expect(client.query(migration)).rejects.toThrow('closure integrity');
      await client.query('ROLLBACK TO SAVEPOINT corrupt_test');
      await client.query('SAVEPOINT rollback_rehearsal');
      await client.query(migration);
      await client.query('ROLLBACK TO SAVEPOINT rollback_rehearsal');
      const restored = await client.query('SELECT manager_id FROM org_nodes WHERE user_id=$1', [
        legacyUsers[1],
      ]);
      expect(restored.rows[0].manager_id).toBe(legacyUsers[0]);
      await client.query(migration);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    }
    const db = getDb();
    await db.insert(organizations).values({
      id: orgId,
      name: 'Graph',
      domains: 'hierarchy.test',
      adminEmail: 'admin@hierarchy.test',
    });
    await db
      .insert(users)
      .values(
        owners.map((id, i) => ({ id, email: names[i] + '@hierarchy.test', displayName: names[i] })),
      );
    await db.insert(mailboxes).values(
      owners.map((ownerUserId, i) => ({
        orgId,
        ownerUserId,
        address: names[i] + '@hierarchy.test',
        provider: 'm365',
      })),
    );
  }, 30000);
  afterAll(async () => {
    await closeDb();
    await client?.end();
  });
  async function verifyClosure(): Promise<void> {
    const graph = await repo.getGraph(orgId);
    const rows = await getDb().select().from(orgClosure);
    const actual = rows.filter((r) => graph.nodes.some((n) => n.id === r.ancestorNodeId));
    const expected = graph.nodes.flatMap((n) =>
      [...descendants(graph, n.id)].map(([descendantNodeId, depth]) => ({
        ancestorNodeId: n.id,
        descendantNodeId,
        depth,
      })),
    );
    const sort = (a: { ancestorNodeId: string; descendantNodeId: string }, b: typeof a): number =>
      (a.ancestorNodeId + a.descendantNodeId).localeCompare(b.ancestorNodeId + b.descendantNodeId);
    expect(actual.sort(sort)).toEqual(expected.sort(sort));
  }
  it('migrates populated legacy forests, backfills titles and preserves user reachability', async () => {
    const graph = await repo.getGraph(legacyOrg);
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.filter((n) => !n.userId)).toHaveLength(1);
    expect(graph.nodes.find((n) => n.userId === legacyUsers[0])?.title).toBe('Position');
    const a = graph.nodes.find((n) => n.userId === legacyUsers[0])!;
    const b = graph.nodes.find((n) => n.userId === legacyUsers[2])!;
    expect(descendants(graph, a.id).has(b.id)).toBe(false);
    expect(await repo.getAllowedMailboxIds(legacyUsers[0])).toHaveLength(2);
    expect(await repo.getAllowedMailboxIds(legacyUsers[2])).toHaveLength(1);
  });
  it('creates the entire vacant Chairman/CEO/CTO diamond then assigns users without changing closure', async () => {
    for (let i = 0; i < ids.length; i++)
      await repo.mutate(
        orgId,
        {
          type: 'create',
          nodeId: ids[i],
          input: { title: names[i], managerNodeIds: parents[i].map((p) => ids[p]) },
        },
        actor,
      );
    expect((await repo.getGraph(orgId)).nodes.every((n) => n.user === null)).toBe(true);
    await verifyClosure();
    for (let i = 0; i < ids.length; i++)
      await repo.mutate(orgId, { type: 'assignment', nodeId: ids[i], userId: owners[i] }, actor);
    await verifyClosure();
    expect(await repo.getAllowedMailboxIds(owners[0])).toHaveLength(9);
    expect(await repo.getAllowedMailboxIds(owners[1])).toHaveLength(7);
    expect(await repo.getAllowedMailboxIds(owners[2])).toHaveLength(7);
    expect(await repo.getAllowedMailboxIds(owners[3])).toHaveLength(3);
    expect(await repo.getAllowedMailboxIds(owners[5])).toHaveLength(1);
    expect(await repo.getAllowedMailboxIds(randomUUID())).toEqual([]);
  });
  it('keeps minimum depth and alternate access after removing reporting paths', async () => {
    await command(5, [0, 3]);
    await verifyClosure();
    const result = await client.query(
      'SELECT depth FROM org_closure WHERE ancestor_node_id=$1 AND descendant_node_id=$2',
      [ids[0], ids[5]],
    );
    expect(result.rows[0].depth).toBe(1);
    await command(5, [3]);
    await command(3, [2]);
    await verifyClosure();
    expect(await repo.getAllowedMailboxIds(owners[1])).toHaveLength(4);
    expect(await repo.getAllowedMailboxIds(owners[2])).toHaveLength(7);
    expect(await repo.getAllowedMailboxIds(owners[0])).toHaveLength(9);
    await command(3, [0]);
    await verifyClosure();
    expect(await repo.getAllowedMailboxIds(owners[2])).toHaveLength(4);
    await command(3, [1, 2]);
  });
  it('rejects invalid edits and serializes reciprocal moves and assignment races', async () => {
    const before = await repo.getGraph(orgId);
    for (const managers of [[], [3], [5], [1, 1]])
      await expect(command(3, managers)).rejects.toThrow();
    await expect(
      repo.mutate(orgId, {
        type: 'managers',
        nodeId: ids[3],
        managerNodeIds: [(await repo.getGraph(legacyOrg)).nodes[0].id],
      }),
    ).rejects.toThrow();
    await expect(repo.mutate(orgId, { type: 'delete', nodeId: ids[3] })).rejects.toThrow('child');
    expect(await repo.getGraph(orgId)).toEqual(before);
    const moves = await Promise.allSettled([command(1, [2]), command(2, [1])]);
    expect(moves.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await command(1, [0]);
    await command(2, [0]);
    const unassigned = randomUUID();
    await getDb()
      .insert(users)
      .values({ id: unassigned, email: 'race@hierarchy.test', displayName: 'Race' });
    const race = await Promise.allSettled(
      [5, 6].map((i) =>
        repo.mutate(orgId, { type: 'assignment', nodeId: ids[i], userId: unassigned }, actor),
      ),
    );
    expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const i of [5, 6])
      await repo.mutate(orgId, { type: 'assignment', nodeId: ids[i], userId: owners[i] }, actor);
    await verifyClosure();
  });
  it('unassigns and deletes manager users without breaking positions or descendant access', async () => {
    await repo.mutate(orgId, { type: 'assignment', nodeId: ids[3], userId: null }, actor);
    expect(await repo.getAllowedMailboxIds(owners[0])).toHaveLength(8);
    await repo.mutate(orgId, { type: 'assignment', nodeId: ids[3], userId: owners[3] }, actor);
    await client.query('DELETE FROM users WHERE id=$1', [owners[3]]);
    expect((await repo.getGraph(orgId)).nodes.find((n) => n.id === ids[3])?.userId).toBeNull();
    expect(await repo.getAllowedMailboxIds(owners[0])).toHaveLength(8);
    await verifyClosure();
    await repo.mutate(orgId, { type: 'delete', nodeId: ids[5] }, actor);
    await verifyClosure();
    expect(await repo.getAllowedMailboxIds(owners[0])).toHaveLength(7);
  });
  it('returns custom role labels and transactional safe audit snapshots', async () => {
    const [role] = await getDb()
      .insert(roles)
      .values({ name: 'Engineering Lead', baseRole: 'employee' })
      .returning();
    await client.query('UPDATE users SET role_id=$1 WHERE id=$2', [role.id, owners[1]]);
    expect((await repo.getGraph(orgId)).nodes.find((n) => n.id === ids[1])?.user?.roleName).toBe(
      'Engineering Lead',
    );
    const audit = await client.query(
      "SELECT old_value,new_value,actor_email,ip_address FROM audit_log WHERE entity_id=$1 AND new_value->>'operation'='assignment' ORDER BY id DESC",
      [ids[3]],
    );
    expect(audit.rows[0].actor_email).toBe(actor.actorEmail);
    expect(audit.rows[0].new_value.position.orgId).toBe(orgId);
    expect(audit.rows[0].old_value.userId).toBeNull();
    const snapshot = await repo.getGraph(orgId);
    // Invalid actor UUID makes audit INSERT fail: the position update must roll back with it.
    await expect(
      repo.mutate(
        orgId,
        { type: 'update', nodeId: ids[1], input: { title: 'Must rollback' } },
        { ...actor, actorId: 'invalid-uuid' },
      ),
    ).rejects.toThrow();
    expect(await repo.getGraph(orgId)).toEqual(snapshot);
    await getDb().execute(sql`SELECT 1`);
  });
  it('preserves retained inactive mailboxes and safely races deletion against assignment', async () => {
    const scopeBefore = await repo.getAllowedMailboxIds(owners[0]);
    await client.query("UPDATE users SET status='inactive' WHERE id=$1", [owners[2]]);
    expect(await repo.getAllowedMailboxIds(owners[0])).toEqual(scopeBefore);
    const nodeId = randomUUID(),
      userId = randomUUID();
    await getDb()
      .insert(users)
      .values({ id: userId, email: 'deletion-race@hierarchy.test', displayName: 'Deletion race' });
    await repo.mutate(
      orgId,
      { type: 'create', nodeId, input: { title: 'Race vacancy', managerNodeIds: [ids[0]] } },
      actor,
    );
    const results = await Promise.allSettled([
      repo.mutate(orgId, { type: 'assignment', nodeId, userId }, actor),
      client.query('DELETE FROM users WHERE id=$1', [userId]),
    ]);
    expect(results[1].status).toBe('fulfilled');
    expect((await repo.getGraph(orgId)).nodes.find((n) => n.id === nodeId)?.userId).toBeNull();
    await verifyClosure();
    await repo.mutate(orgId, { type: 'delete', nodeId }, actor);
    const outsider = randomUUID();
    await getDb()
      .insert(users)
      .values({ id: outsider, email: 'outsider@different.test', displayName: 'Outside' });
    await expect(
      repo.mutate(orgId, { type: 'assignment', nodeId: ids[3], userId: outsider }),
    ).rejects.toThrow('organization');
  });
});
