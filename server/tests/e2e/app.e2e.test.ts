import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashPassword } from '../../src/lib/password';
import { sharedMemoryRepo } from '../../src/modules/users/user.repository';

const app = createApp();

// Seed the super-admin into the shared singleton that all routers use.
beforeAll(async () => {
  const hash = await hashPassword('secret-pass-123');
  await sharedMemoryRepo.createWithHash(
    { email: 'e2e@acme.com', displayName: 'E2E Admin', role: 'superadmin' },
    hash,
  );
});

describe('GET /api/v1/health', () => {
  it('returns healthy status', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});

describe('users routes', () => {
  let adminToken: string;

  // Login once as the seeded super-admin to get a token for protected routes.
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'e2e@acme.com', password: 'secret-pass-123' });
    adminToken = res.body.data.tokens.accessToken;
  });

  it('creates a user (201) and lists it (200)', async () => {
    const create = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'newuser@acme.com', displayName: 'E2E User' });

    expect(create.status).toBe(201);
    expect(create.body.data.email).toBe('newuser@acme.com');

    const list = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects an invalid email with 400 + validation_error', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'not-an-email', displayName: 'X' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });
});

describe('unknown route', () => {
  it('returns 404 with the shared error envelope', async () => {
    const res = await request(app).get('/api/v1/nope');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });
});

describe('auth routes', () => {
  it('POST /auth/login rejects bad credentials with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@acme.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('unauthorized');
  });

  it('POST /auth/login rejects a malformed body with 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('GET /auth/me returns 401 without a token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});
