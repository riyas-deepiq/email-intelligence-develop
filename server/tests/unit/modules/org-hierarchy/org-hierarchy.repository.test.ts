import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryMailboxRepository } from '../../../../src/modules/mailboxes/mailbox.repository';
import { InMemoryUserRepository } from '../../../../src/modules/users/user.repository';
import { InMemoryOrgHierarchyRepository } from '../../../../src/modules/org-hierarchy/org-hierarchy.repository';
import { descendants } from '../../../../src/modules/org-hierarchy/org-hierarchy.graph';
import { sharedMemoryRoleRepo } from '../../../../src/modules/roles/role.repository';

describe('position graph memory contract', () => {
  let users: InMemoryUserRepository,
    boxes: InMemoryMailboxRepository,
    repo: InMemoryOrgHierarchyRepository;
  const org = randomUUID();
  const ids = ['Chairman', 'CEO', 'CTO', 'Manager1', 'Manager2', 'E1', 'E2', 'E3', 'E4'];
  const parents = [
    [],
    ['Chairman'],
    ['Chairman'],
    ['CEO', 'CTO'],
    ['CEO', 'CTO'],
    ['Manager1'],
    ['Manager1'],
    ['Manager2'],
    ['Manager2'],
  ];
  beforeEach(async () => {
    users = new InMemoryUserRepository();
    boxes = new InMemoryMailboxRepository();
    repo = new InMemoryOrgHierarchyRepository(boxes, users);
    for (let i = 0; i < ids.length; i++)
      await repo.mutate(org, {
        type: 'create',
        nodeId: ids[i],
        input: { title: ids[i], managerNodeIds: parents[i] },
      });
  });
  async function populate(): Promise<{ owners: Map<string, string>; mail: Map<string, string> }> {
    const owners = new Map<string, string>(),
      mail = new Map<string, string>();
    for (const name of ids) {
      const u = await users.create({ email: name + '@test.example', displayName: name });
      owners.set(name, u.id);
      mail.set(
        name,
        (await boxes.create({ orgId: org, ownerUserId: u.id, address: u.email, provider: 'm365' }))
          .id,
      );
      await repo.mutate(org, { type: 'assignment', nodeId: name, userId: u.id });
    }
    return { owners, mail };
  }
  it('designs the entire diamond while vacant and computes shortest paths', async () => {
    const graph = await repo.getGraph(org);
    expect(graph.nodes).toHaveLength(9);
    expect(graph.nodes.every((n) => n.user === null)).toBe(true);
    expect(graph.reportingLines).toHaveLength(10);
    expect(descendants(graph, 'Chairman').size).toBe(9);
    await repo.mutate(org, {
      type: 'managers',
      nodeId: 'E1',
      managerNodeIds: ['Chairman', 'Manager1'],
    });
    expect(descendants(await repo.getGraph(org), 'Chairman').get('E1')).toBe(1);
  });
  it('grants shared branches without duplicate mailboxes or peer access', async () => {
    const { owners, mail } = await populate();
    expect(await repo.getAllowedMailboxIds(owners.get('Chairman')!)).toHaveLength(9);
    for (const name of ['CEO', 'CTO'])
      expect(await repo.getAllowedMailboxIds(owners.get(name)!)).toHaveLength(7);
    expect(await repo.getAllowedMailboxIds(owners.get('Manager1')!)).toEqual(
      [mail.get('Manager1'), mail.get('E1'), mail.get('E2')].sort(),
    );
    expect(await repo.getAllowedMailboxIds(owners.get('E1')!)).toEqual([mail.get('E1')]);
    expect(await repo.getAllowedMailboxIds(randomUUID())).toEqual([]);
  });
  it('preserves alternate paths and revokes access after the last path is removed', async () => {
    const { owners, mail } = await populate();
    await repo.mutate(org, { type: 'managers', nodeId: 'Manager1', managerNodeIds: ['CTO'] });
    expect(await repo.getAllowedMailboxIds(owners.get('CEO')!)).not.toContain(mail.get('E1'));
    expect(await repo.getAllowedMailboxIds(owners.get('CTO')!)).toContain(mail.get('E1'));
    expect(await repo.getAllowedMailboxIds(owners.get('Chairman')!)).toContain(mail.get('E1'));
    await repo.mutate(org, { type: 'managers', nodeId: 'Manager1', managerNodeIds: ['Chairman'] });
    expect(await repo.getAllowedMailboxIds(owners.get('CTO')!)).not.toContain(mail.get('E1'));
  });
  it('unassigns, replaces and moves users; deletion preserves vacant positions and descendants', async () => {
    const { owners, mail } = await populate();
    const edges = (await repo.getGraph(org)).reportingLines;
    await repo.mutate(org, { type: 'assignment', nodeId: 'Manager1', userId: null });
    expect(await repo.getAllowedMailboxIds(owners.get('Chairman')!)).toContain(mail.get('E1'));
    await repo.mutate(org, {
      type: 'assignment',
      nodeId: 'Manager2',
      userId: owners.get('Manager1')!,
    });
    expect((await repo.getGraph(org)).reportingLines).toEqual(edges);
    await users.deleteById(owners.get('Manager1')!);
    expect((await repo.getGraph(org)).nodes.find((n) => n.id === 'Manager2')?.userId).toBeNull();
    expect(await repo.getAllowedMailboxIds(owners.get('Chairman')!)).toContain(mail.get('E3'));
  });
  it('rejects duplicate assignments, missing/inactive users and foreign mailbox ownership', async () => {
    const { owners } = await populate();
    await expect(
      repo.mutate(org, { type: 'assignment', nodeId: 'E2', userId: owners.get('E1')! }),
    ).rejects.toThrow('already');
    await expect(
      repo.mutate(org, { type: 'assignment', nodeId: 'E2', userId: randomUUID() }),
    ).rejects.toThrow('not found');
    const u = await users.create({
      email: 'inactive@test.example',
      displayName: 'Inactive',
      status: 'inactive',
    });
    await expect(
      repo.mutate(org, { type: 'assignment', nodeId: 'E2', userId: u.id }),
    ).rejects.toThrow('inactive');
    const other = await users.create({ email: 'other@test.example', displayName: 'Other' });
    await boxes.create({
      orgId: randomUUID(),
      ownerUserId: other.id,
      address: other.email,
      provider: 'm365',
    });
    await expect(
      repo.mutate(org, { type: 'assignment', nodeId: 'E2', userId: other.id }),
    ).rejects.toThrow('organization');
  });
  it('rejects root disconnection, cycles, duplicate/foreign managers and non-leaf deletion atomically', async () => {
    const before = await repo.getGraph(org);
    for (const managers of [[], ['Manager1'], ['E1'], ['CEO', 'CEO'], [randomUUID()]]) {
      await expect(
        repo.mutate(org, { type: 'managers', nodeId: 'Manager1', managerNodeIds: managers }),
      ).rejects.toThrow();
      expect(await repo.getGraph(org)).toEqual(before);
    }
    await expect(repo.mutate(org, { type: 'delete', nodeId: 'CEO' })).rejects.toThrow('child');
    await expect(
      repo.mutate(randomUUID(), { type: 'update', nodeId: 'CEO', input: { title: 'X' } }),
    ).rejects.toThrow('not found');
    await repo.mutate(org, { type: 'delete', nodeId: 'E1' });
    expect((await repo.getGraph(org)).nodes).toHaveLength(8);
  });
  it('serializes concurrent reciprocal moves and user assignment', async () => {
    const moves = await Promise.allSettled([
      repo.mutate(org, { type: 'managers', nodeId: 'CEO', managerNodeIds: ['CTO'] }),
      repo.mutate(org, { type: 'managers', nodeId: 'CTO', managerNodeIds: ['CEO'] }),
    ]);
    expect(moves.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const u = await users.create({ email: 'race@test.example', displayName: 'Race' });
    const assignments = await Promise.allSettled(
      ['E1', 'E2'].map((nodeId) => repo.mutate(org, { type: 'assignment', nodeId, userId: u.id })),
    );
    expect(assignments.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('resolves current custom role labels like the PostgreSQL join', async () => {
    const role = await sharedMemoryRoleRepo.create({
      name: 'Design Lead',
      description: 'Test',
      baseRole: 'employee',
      permissions: [],
    });
    const user = await users.create({
      email: 'design@test.example',
      displayName: 'Designer',
      roleId: role.id,
    });
    await repo.mutate(org, { type: 'assignment', nodeId: 'E1', userId: user.id });
    expect((await repo.getGraph(org)).nodes.find((n) => n.id === 'E1')?.user?.roleName).toBe(
      'Design Lead',
    );
    await sharedMemoryRoleRepo.update(role.id, { name: 'Product Lead' });
    expect((await repo.getGraph(org)).nodes.find((n) => n.id === 'E1')?.user?.roleName).toBe(
      'Product Lead',
    );
    await sharedMemoryRoleRepo.delete(role.id);
  });
});
