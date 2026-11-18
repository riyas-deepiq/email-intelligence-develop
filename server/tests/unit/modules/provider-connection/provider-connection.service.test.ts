import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryAuthProviderRepository } from '../../../../src/modules/auth-providers/auth-provider.repository';
import { InMemoryMailboxRepository } from '../../../../src/modules/mailboxes/mailbox.repository';
import { InMemoryOrgRepository } from '../../../../src/modules/organizations/org.repository';
import { listAllM365Users } from '../../../../src/modules/provider-connection/clients/m365.client';
import {
  listAllGoogleUsers,
  testGoogleConnection,
} from '../../../../src/modules/provider-connection/clients/google.client';
import { ProviderConnectionService } from '../../../../src/modules/provider-connection/provider-connection.service';

vi.mock('../../../../src/modules/provider-connection/clients/m365.client', () => ({
  listAllM365Users: vi.fn(),
  testM365Connection: vi.fn(),
}));

vi.mock('../../../../src/modules/provider-connection/clients/google.client', () => ({
  listAllGoogleUsers: vi.fn(),
  testGoogleConnection: vi.fn(),
}));

vi.mock('../../../../src/lib/mailer', () => ({
  sendMailboxConnectedEmail: vi.fn().mockResolvedValue(undefined),
}));

describe('ProviderConnectionService initial discovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not queue every discovered mailbox before the setup selection is saved', async () => {
    vi.mocked(listAllM365Users).mockResolvedValue([
      {
        id: 'provider-user-1',
        email: 'one@example.test',
        displayName: 'One',
        givenName: 'One',
        familyName: 'User',
        jobTitle: null,
        department: null,
        photoData: null,
      },
      {
        id: 'provider-user-2',
        email: 'two@example.test',
        displayName: 'Two',
        givenName: 'Two',
        familyName: 'User',
        jobTitle: null,
        department: null,
        photoData: null,
      },
    ]);

    const orgRepo = new InMemoryOrgRepository();
    await orgRepo.upsert({
      name: 'Example',
      domains: 'example.test',
      adminEmail: 'admin@example.test',
    });
    const collector = { triggerInitialSyncIfNeeded: vi.fn().mockResolvedValue(true) };
    const service = new ProviderConnectionService(
      new InMemoryAuthProviderRepository(),
      new InMemoryMailboxRepository(),
      orgRepo,
      undefined,
      undefined,
      undefined,
      undefined,
      collector,
    );

    const result = await service.connect({
      provider: 'm365',
      tenantId: 'tenant',
      clientId: 'client',
      clientSecret: 'secret',
      confirmed: true,
    });

    expect(result.mailboxesCreated).toBe(2);
    expect(collector.triggerInitialSyncIfNeeded).not.toHaveBeenCalled();
  });

  it('stores one decryptable Google key with stable delegation settings', async () => {
    vi.mocked(testGoogleConnection).mockResolvedValue({
      valid: true,
      canListUsers: true,
      canReadMail: true,
      userCount: 1,
      sampleUsers: [{ email: 'one@example.test', displayName: 'One' }],
    });
    vi.mocked(listAllGoogleUsers).mockResolvedValue([
      {
        id: 'google-user-1',
        email: 'one@example.test',
        displayName: 'One',
        givenName: 'One',
        familyName: 'User',
        jobTitle: null,
        department: null,
        photoData: null,
      },
    ]);

    const orgRepo = new InMemoryOrgRepository();
    await orgRepo.upsert({
      name: 'Example',
      domains: 'example.test',
      adminEmail: 'insight-admin@example.test',
    });
    const authRepo = new InMemoryAuthProviderRepository();
    const collector = { triggerInitialSyncIfNeeded: vi.fn().mockResolvedValue(true) };
    const service = new ProviderConnectionService(
      authRepo,
      new InMemoryMailboxRepository(),
      orgRepo,
      undefined,
      undefined,
      undefined,
      undefined,
      collector,
    );
    const serviceAccountJson = JSON.stringify({
      client_email: 'collector@project.iam.gserviceaccount.com',
      client_id: '123456',
      private_key: 'private-key',
    });

    const result = await service.connect({
      provider: 'google',
      serviceAccountJson,
      adminEmail: 'workspace-admin@example.test',
      customerId: 'my_customer',
      confirmed: true,
    });

    const saved = await authRepo.findWithSecret('google');
    expect(result.mailboxesCreated).toBe(1);
    expect(saved?.serviceAccountJson).toBe(serviceAccountJson);
    expect(saved?.googleAdminEmail).toBe('workspace-admin@example.test');
    expect(saved?.googleCustomerId).toBe('my_customer');
    expect(collector.triggerInitialSyncIfNeeded).not.toHaveBeenCalled();
  });

  it('reuses the stored Google key when the admin tests without uploading it again', async () => {
    const orgRepo = new InMemoryOrgRepository();
    const authRepo = new InMemoryAuthProviderRepository();
    await authRepo.upsert('google', {
      enabled: false,
      serviceAccountJson: '{"saved":true}',
      googleAdminEmail: 'admin@example.test',
      googleCustomerId: 'my_customer',
    });
    vi.mocked(testGoogleConnection).mockResolvedValue({
      valid: true,
      canListUsers: true,
      canReadMail: true,
      userCount: 1,
      sampleUsers: [{ email: 'one@example.test', displayName: 'One' }],
    });
    const service = new ProviderConnectionService(
      authRepo,
      new InMemoryMailboxRepository(),
      orgRepo,
    );

    const result = await service.testConnection({
      provider: 'google',
      serviceAccountJson: '',
      adminEmail: 'admin@example.test',
      customerId: 'my_customer',
    });

    expect(result.valid).toBe(true);
    expect(testGoogleConnection).toHaveBeenCalledWith(
      '{"saved":true}',
      'admin@example.test',
      'my_customer',
    );
  });
});
