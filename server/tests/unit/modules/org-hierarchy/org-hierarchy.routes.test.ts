import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { orgHierarchyRouter } from '../../../../src/modules/org-hierarchy/org-hierarchy.routes';
import { sharedMemoryOrgRepo } from '../../../../src/modules/organizations/org.repository';
import { sharedMemoryRepo } from '../../../../src/modules/users/user.repository';
import { sessionStore } from '../../../../src/lib/session-store';
import { signAccessToken } from '../../../../src/lib/token';
import { errorHandler } from '../../../../src/middleware/error.middleware';

describe('real hierarchy HTTP authorization and validation', () => {
  const app = express().use(express.json()).use('/hierarchy', orgHierarchyRouter).use(errorHandler);
  const tokens: Record<string, string> = {},
    ids: Record<string, string> = {};
  let root: string;
  beforeAll(async () => {
    await sharedMemoryOrgRepo.upsert({
      name: 'HTTP',
      domains: 'http.test',
      adminEmail: 'superadmin@http.test',
    });
    for (const role of ['employee', 'admin', 'superadmin'] as const) {
      const u = await sharedMemoryRepo.create({
        email: role + '@http.test',
        displayName: role,
        role,
      });
      const sessionId = randomUUID();
      await sessionStore.set(sessionId, u.id, 600);
      tokens[role] = signAccessToken({
        sub: u.id,
        email: u.email,
        displayName: u.displayName,
        role,
        sessionId,
      });
      ids[role] = u.id;
    }
  });
  const auth = (role = 'superadmin'): string => 'Bearer ' + tokens[role];
  it('requires authentication and denies ordinary graph reads', async () => {
    expect((await request(app).get('/hierarchy')).status).toBe(401);
    expect(
      (await request(app).get('/hierarchy').set('Authorization', auth('employee'))).status,
    ).toBe(403);
    expect((await request(app).get('/hierarchy').set('Authorization', auth())).status).toBe(200);
  });
  it('permits only Super Admin writes, including users with admin org.manage permission', async () => {
    for (const role of ['employee', 'admin']) {
      expect(
        (
          await request(app)
            .post('/hierarchy/nodes')
            .set('Authorization', auth(role))
            .send({ title: 'Denied' })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .put('/hierarchy/nodes/' + randomUUID() + '/assignment')
            .set('Authorization', auth(role))
            .send({ userId: null })
        ).status,
      ).toBe(403);
    }
    const res = await request(app)
      .post('/hierarchy/nodes')
      .set('Authorization', auth())
      .send({ title: 'Chairman' });
    expect(res.status).toBe(201);
    root = res.body.data.nodes[0].id;
  });
  it('validates every route ID, manager array and assignment body before SQL', async () => {
    const requests = [
      request(app).patch('/hierarchy/nodes/bad').send({ title: 'Bad' }),
      request(app).delete('/hierarchy/nodes/bad'),
      request(app).put('/hierarchy/nodes/bad/managers').send({ managerNodeIds: [] }),
      request(app)
        .put('/hierarchy/nodes/' + root + '/managers')
        .send({ managerNodeIds: ['bad'] }),
      request(app)
        .put('/hierarchy/nodes/' + root + '/assignment')
        .send({ userId: 'bad' }),
      request(app)
        .put('/hierarchy/nodes/' + root + '/assignment')
        .send({}),
      request(app).get('/hierarchy/scope/bad'),
    ];
    for (const req of requests) expect((await req.set('Authorization', auth())).status).toBe(400);
  });
  it('assigns and unassigns without changing edges and confines self-scope metadata', async () => {
    const assigned = await request(app)
      .put('/hierarchy/nodes/' + root + '/assignment')
      .set('Authorization', auth())
      .send({ userId: ids.employee });
    expect(assigned.status).toBe(200);
    const self = await request(app)
      .get('/hierarchy/scope/' + ids.employee)
      .set('Authorization', auth('employee'));
    expect(self.status).toBe(200);
    expect(self.body.data).not.toHaveProperty('nodes');
    expect(
      (
        await request(app)
          .get('/hierarchy/scope/' + ids.superadmin)
          .set('Authorization', auth('employee'))
      ).status,
    ).toBe(403);
    const preview = await request(app)
      .get('/hierarchy/scope/' + ids.employee)
      .set('Authorization', auth());
    expect(preview.body.data.nodes).toHaveLength(1);
    expect(
      (
        await request(app)
          .put('/hierarchy/nodes/' + root + '/assignment')
          .set('Authorization', auth())
          .send({ userId: null })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .delete('/hierarchy/nodes/' + root)
          .set('Authorization', auth())
      ).status,
    ).toBe(204);
  });
});
