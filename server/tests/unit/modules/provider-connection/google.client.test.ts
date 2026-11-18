import { beforeEach, describe, expect, it, vi } from 'vitest';

const googleMocks = vi.hoisted(() => ({
  directoryList: vi.fn(),
  photoGet: vi.fn(),
  getProfile: vi.fn(),
  jwt: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { JWT: googleMocks.jwt },
    admin: vi.fn(() => ({
      users: {
        list: googleMocks.directoryList,
        photos: { get: googleMocks.photoGet },
      },
    })),
    gmail: vi.fn(() => ({ users: { getProfile: googleMocks.getProfile } })),
  },
}));

import {
  listAllGoogleUsers,
  testGoogleConnection,
} from '../../../../src/modules/provider-connection/clients/google.client';

const key = JSON.stringify({
  client_email: 'collector@project.iam.gserviceaccount.com',
  client_id: '123456',
  private_key: 'private-key',
});

const activeUsers = [
  {
    id: 'one',
    primaryEmail: 'one@example.test',
    name: { fullName: 'One User', givenName: 'One', familyName: 'User' },
    organizations: [{ title: 'Engineer', department: 'Product' }],
    isMailboxSetup: true,
    suspended: false,
    archived: false,
  },
  {
    id: 'two',
    primaryEmail: 'two@secondary.test',
    name: { fullName: 'Two User' },
    isMailboxSetup: true,
    suspended: false,
    archived: false,
  },
  {
    id: 'suspended',
    primaryEmail: 'off@example.test',
    name: { fullName: 'Off User' },
    isMailboxSetup: true,
    suspended: true,
    archived: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  googleMocks.directoryList.mockResolvedValue({ data: { users: activeUsers } });
  googleMocks.photoGet.mockResolvedValue({ data: {} });
  googleMocks.getProfile.mockResolvedValue({ data: { historyId: 'H1' } });
});

describe('Google provider connection client', () => {
  it('discovers all customer domains and verifies Gmail access against a real mailbox', async () => {
    const result = await testGoogleConnection(key, 'admin@example.test', 'my_customer');

    expect(result).toMatchObject({
      valid: true,
      canListUsers: true,
      canReadMail: true,
      userCount: 2,
    });
    expect(googleMocks.directoryList).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'my_customer', maxResults: 500 }),
    );
    expect(googleMocks.getProfile).toHaveBeenCalledWith({ userId: 'me' });
    expect(googleMocks.jwt).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'one@example.test' }),
    );
  });

  it('reports Gmail permission failure separately from successful directory access', async () => {
    googleMocks.getProfile.mockRejectedValue(new Error('403 forbidden'));

    const result = await testGoogleConnection(key, 'admin@example.test', 'my_customer');

    expect(result.valid).toBe(false);
    expect(result.canListUsers).toBe(true);
    expect(result.canReadMail).toBe(false);
    expect(result.error).toContain('Gmail access failed');
  });

  it('filters suspended users and domains outside the organization allow-list', async () => {
    const users = await listAllGoogleUsers(key, 'admin@example.test', 'my_customer', [
      'example.test',
    ]);

    expect(users.map((user) => user.email)).toEqual(['one@example.test']);
    expect(users[0]).toMatchObject({ jobTitle: 'Engineer', department: 'Product' });
  });
});
