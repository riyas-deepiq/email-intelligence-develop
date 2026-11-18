import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryOrgRepository } from '../../../../src/modules/organizations/org.repository';
import { InMemoryUserRepository } from '../../../../src/modules/users/user.repository';
import { InMemoryMailboxRepository } from '../../../../src/modules/mailboxes/mailbox.repository';
import { InMemoryOrgHierarchyRepository } from '../../../../src/modules/org-hierarchy/org-hierarchy.repository';
import { OrgHierarchyService } from '../../../../src/modules/org-hierarchy/org-hierarchy.service';
describe('hierarchy service', () => {
  it('uses the configured organization and previews safe descendant paths', async () => {
    const orgs = new InMemoryOrgRepository(),
      users = new InMemoryUserRepository(),
      boxes = new InMemoryMailboxRepository();
    const service = new OrgHierarchyService(
      new InMemoryOrgHierarchyRepository(boxes, users, orgs),
      orgs,
    );
    await expect(service.getTree()).rejects.toThrow('No organization');
    const org = await orgs.upsert({
      name: 'Test',
      domains: 'test.example',
      adminEmail: 'admin@test.example',
    });
    expect(await service.getTree()).toEqual({ nodes: [], reportingLines: [] });
    const root = (await service.create({ title: 'Chairman', managerNodeIds: [] })).nodes[0];
    const child = (
      await service.create({ title: 'Vacant Manager', managerNodeIds: [root.id] })
    ).nodes.find((n) => n.id !== root.id)!;
    const user = await users.create({ email: 'person@test.example', displayName: 'Person' });
    await boxes.create({
      orgId: org.id,
      ownerUserId: user.id,
      address: user.email,
      provider: 'm365',
    });
    await service.mutate({ type: 'assignment', nodeId: root.id, userId: user.id });
    const scope = await service.getScope(user.id);
    expect(scope.nodes.map((n) => n.id).sort()).toEqual([root.id, child.id].sort());
    expect(scope.reportingLines).toHaveLength(1);
    expect(scope.mailboxIds).toHaveLength(1);
    expect((await service.getScope(randomUUID())).mailboxIds).toEqual([]);
    const foreign = await users.create({ email: 'other@outside.example', displayName: 'Other' });
    await expect(
      service.mutate({ type: 'assignment', nodeId: child.id, userId: foreign.id }),
    ).rejects.toThrow('organization');
  });
});
