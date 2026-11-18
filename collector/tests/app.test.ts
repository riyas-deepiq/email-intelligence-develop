import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, type HealthState } from '../src/app';

function healthState(overrides: Partial<HealthState> = {}): HealthState {
  return {
    instance: 'test-host:1234',
    activeWorkers: 0,
    lastPollAt: null,
    lastPollOk: null,
    lastPollError: null,
    jobsSucceeded: 0,
    jobsFailed: 0,
    ...overrides,
  };
}

describe('GET /health', () => {
  it('reports ok with the live worker state', async () => {
    const app = createApp(() =>
      healthState({ activeWorkers: 2, lastPollOk: true, jobsSucceeded: 7 }),
    );
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.instance).toBe('test-host:1234');
    expect(res.body.activeWorkers).toBe(2);
    expect(res.body.jobsSucceeded).toBe(7);
    expect(typeof res.body.uptime).toBe('number');
  });

  it('reports ok before the first poll has completed', async () => {
    const app = createApp(() => healthState());
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('reports degraded (still HTTP 200) when the last poll failed', async () => {
    const app = createApp(() =>
      healthState({ lastPollOk: false, lastPollError: 'connect ECONNREFUSED' }),
    );
    const res = await request(app).get('/health');

    // 200 on purpose: a server outage must not make an orchestrator
    // restart-loop a healthy collector process.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.lastPollError).toContain('ECONNREFUSED');
  });
});

describe('everything else', () => {
  it('exposes no other routes', async () => {
    const app = createApp(() => healthState());
    for (const path of ['/', '/api/v1/health', '/api/v1/sync/run', '/jobs']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
    }
    expect((await request(app).post('/health')).status).toBe(404);
  });
});
