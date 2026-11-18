import type { AuthProviderRepository } from '../auth-providers/auth-provider.repository';
import type { AuditActor, AuditService } from '../audit/audit.service';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { sendMailboxConnectedEmail } from '../../lib/mailer';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';
import { parseDataUri, type MailboxPhotoRepository } from '../mailboxes/mailbox-photo.repository';
import type { OrgRepository } from '../organizations/org.repository';
import type { UserRepository } from '../users/user.repository';
import type { AlertService } from '../alerts/alert.service';
import type { CollectorService } from '../../services/collector.service';
import { listAllM365Users, testM365Connection } from './clients/m365.client';
import { listAllGoogleUsers, testGoogleConnection } from './clients/google.client';
import type {
  ConnectPayload,
  ConnectResponse,
  ProviderStatusResponse,
  TestConnectionPayload,
  TestConnectionResponse,
} from './provider-connection.types';

export class ProviderConnectionService {
  constructor(
    private readonly authProviderRepo: AuthProviderRepository,
    private readonly mailboxRepo: MailboxRepository,
    private readonly orgRepo: OrgRepository,
    private readonly audit?: AuditService,
    private readonly userRepo?: UserRepository,
    private readonly photoRepo?: MailboxPhotoRepository,
    private readonly alerts?: AlertService,
    private readonly collector?: Pick<CollectorService, 'triggerInitialSyncIfNeeded'>,
  ) {}

  /**
   * Queue first sync for mailboxes discovered by an explicit directory resync.
   * Initial provider connection deliberately does not call this: the setup
   * wizard must save the administrator's mailbox selection before ingestion
   * work is allowed to start.
   */
  private async queueInitialSyncs(mailboxes: Array<{ id: string }>): Promise<void> {
    if (!this.collector || mailboxes.length === 0) return;
    await Promise.allSettled(
      mailboxes.map((mailbox) => this.collector!.triggerInitialSyncIfNeeded(mailbox.id)),
    );
  }

  /**
   * Persists a single profile photo (Base64 data URI) into the photo table.
   * Best-effort: a failed photo never fails the connection.
   */
  private async savePhoto(mailboxId: string, photoDataUri: string | null): Promise<void> {
    if (!this.photoRepo || !photoDataUri) return;
    const parsed = parseDataUri(photoDataUri);
    if (parsed) await this.photoRepo.upsert(mailboxId, parsed.contentType, parsed.data);
  }

  /**
   * Saves photos for a batch of directory users by resolving each mailbox via its
   * address. Works for both freshly-created and pre-existing mailboxes (so a
   * re-connect still backfills photos that weren't captured on the first connect).
   */
  private async savePhotosByAddress(
    users: { email: string; photoData: string | null }[],
  ): Promise<void> {
    if (!this.photoRepo) return;
    await Promise.allSettled(
      users.map(async (u) => {
        if (!u.photoData) return;
        const mailbox = await this.mailboxRepo.findByAddress(u.email);
        if (mailbox) await this.savePhoto(mailbox.id, u.photoData);
      }),
    );
  }

  /** Returns the saved (non-secret) provider config to prefill the connection form. */
  async getSavedConfig(): Promise<import('./provider-connection.types').ProviderConfigResponse> {
    const m365 = await this.authProviderRepo.findByProvider('m365');
    const google = await this.authProviderRepo.findByProvider('google');
    return {
      m365: {
        tenantId: m365?.tenantId ?? null,
        clientId: m365?.clientId ?? null,
        hasClientSecret: m365?.hasClientSecret ?? false,
        connected: !!(m365?.tenantId && m365?.clientId && m365?.hasClientSecret),
      },
      google: {
        hasServiceAccount: google?.hasServiceAccount ?? false,
        adminEmail: google?.googleAdminEmail ?? null,
        customerId: google?.googleCustomerId ?? null,
        connected: !!(
          google?.hasServiceAccount &&
          google.googleAdminEmail &&
          google.googleCustomerId
        ),
      },
    };
  }

  /** Resolves the M365 client secret, falling back to the stored one when left blank. */
  private async resolveM365Secret(provided: string): Promise<string> {
    if (provided) return provided;
    const stored = await this.authProviderRepo.findWithSecret('m365');
    return stored?.clientSecret ?? '';
  }

  /** Resolves the Google key, falling back to the stored encrypted credential. */
  private async resolveGoogleServiceAccount(provided: string): Promise<string> {
    if (provided) return provided;
    const stored = await this.authProviderRepo.findWithSecret('google');
    return stored?.serviceAccountJson ?? '';
  }

  async testConnection(payload: TestConnectionPayload): Promise<TestConnectionResponse> {
    if (payload.provider === 'm365') {
      const clientSecret = await this.resolveM365Secret(payload.clientSecret);
      if (!clientSecret) {
        return {
          valid: false,
          permissions: { canListUsers: false, canReadMail: false },
          userCount: 0,
          sampleUsers: [],
          error: 'Client secret is required (none is saved yet for this provider).',
        };
      }
      const result = await testM365Connection(payload.tenantId, payload.clientId, clientSecret);
      return {
        valid: result.valid,
        permissions: { canListUsers: result.canListUsers, canReadMail: result.canReadMail },
        userCount: result.userCount,
        sampleUsers: result.sampleUsers,
        error: result.error,
      };
    }

    const serviceAccountJson = await this.resolveGoogleServiceAccount(payload.serviceAccountJson);
    if (!serviceAccountJson) {
      return {
        valid: false,
        permissions: { canListUsers: false, canReadMail: false },
        userCount: 0,
        sampleUsers: [],
        error: 'Service account JSON is required (none is saved yet for this provider).',
      };
    }
    const result = await testGoogleConnection(
      serviceAccountJson,
      payload.adminEmail,
      payload.customerId,
    );
    return {
      valid: result.valid,
      permissions: { canListUsers: result.canListUsers, canReadMail: result.canReadMail },
      userCount: result.userCount,
      sampleUsers: result.sampleUsers,
      error: result.error,
    };
  }

  async connect(payload: ConnectPayload, actor?: AuditActor): Promise<ConnectResponse> {
    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');
    const orgId = org.id;

    // Parse allowed domains from org configuration
    const allowedDomains = org.domains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    if (payload.provider === 'm365') {
      const p = payload as import('./provider-connection.types').M365TestPayload & {
        confirmed: true;
      };
      const clientSecret = await this.resolveM365Secret(p.clientSecret);
      if (!clientSecret)
        throw new ValidationError(
          'Client secret is required (none is saved yet for this provider).',
        );

      // Store the mail-ingestion credentials WITHOUT touching the SSO `enabled`
      // flag. The auth_providers row is shared with the OIDC/SSO login config, so
      // connecting an email provider must not silently turn on SSO sign-in.
      const existingM365 = await this.authProviderRepo.findByProvider('m365');
      await this.authProviderRepo.upsert('m365', {
        enabled: existingM365?.enabled ?? false,
        tenantId: p.tenantId,
        clientId: p.clientId,
        clientSecret,
      });

      const users = await listAllM365Users(p.tenantId, p.clientId, clientSecret, allowedDomains);

      const created = await this.mailboxRepo.createMany(
        users.map((u) => ({
          orgId,
          address: u.email,
          provider: 'm365' as const,
          providerUserId: u.id,
          displayName: u.displayName || null,
          givenName: u.givenName || null,
          familyName: u.familyName || null,
          jobTitle: u.jobTitle,
          departmentName: u.department,
        })),
      );
      // Backward link: match each mailbox address to an existing user
      await this.linkMailboxesToUsers(created.map((m) => ({ id: m.id, address: m.address })));

      // Persist profile photos into the dedicated photo table (not the mailbox row).
      // Resolve by address so existing mailboxes are backfilled on re-connect too.
      await this.savePhotosByAddress(users);

      sendMailboxConnectedEmail(org.adminEmail, 'm365', created.length, org.name).catch((err) =>
        logger.warn({ err }, 'Failed to send mailbox-connected admin alert'),
      );

      if (actor) {
        await this.audit?.mailboxEvent('mailbox.connected', actor, orgId, null, {
          provider: 'm365',
          mailboxesCreated: created.length,
          domainsFiltered: allowedDomains,
        });
      }

      return {
        mailboxesCreated: created.length,
        mailboxesDiscovered: users.length,
        provider: 'm365',
      };
    }

    const p = payload as import('./provider-connection.types').GoogleTestPayload & {
      confirmed: true;
    };
    const serviceAccountJson = await this.resolveGoogleServiceAccount(p.serviceAccountJson);
    if (!serviceAccountJson) {
      throw new ValidationError(
        'Service account JSON is required (none is saved yet for this provider).',
      );
    }
    // Revalidate at the server boundary. The UI's earlier test is informative,
    // but inputs can change afterward and API callers can bypass the UI.
    const validation = await testGoogleConnection(serviceAccountJson, p.adminEmail, p.customerId);
    if (!validation.valid) {
      throw new ValidationError(
        validation.error ?? 'Google Workspace connection validation failed',
      );
    }

    const users = await listAllGoogleUsers(
      serviceAccountJson,
      p.adminEmail,
      p.customerId,
      allowedDomains,
    );

    // Persist only after both Directory and Gmail access have succeeded, so a
    // failed connection never appears configured merely because a key was saved.
    const existingGoogle = await this.authProviderRepo.findByProvider('google');
    await this.authProviderRepo.upsert('google', {
      enabled: existingGoogle?.enabled ?? false,
      // Repository owns encryption. Passing already-encrypted data here would
      // double-encrypt it and leave the collector with non-JSON ciphertext.
      serviceAccountJson,
      googleAdminEmail: p.adminEmail,
      googleCustomerId: p.customerId,
    });

    const created = await this.mailboxRepo.createMany(
      users.map((u) => ({
        orgId,
        address: u.email,
        provider: 'google' as const,
        providerUserId: u.id,
        displayName: u.displayName || null,
        givenName: u.givenName || null,
        familyName: u.familyName || null,
        jobTitle: u.jobTitle,
        departmentName: u.department,
      })),
    );
    await this.linkMailboxesToUsers(created.map((m) => ({ id: m.id, address: m.address })));

    await this.savePhotosByAddress(users);

    sendMailboxConnectedEmail(org.adminEmail, 'google', created.length, org.name).catch((err) =>
      logger.warn({ err }, 'Failed to send mailbox-connected admin alert'),
    );

    if (actor) {
      await this.audit?.mailboxEvent('mailbox.connected', actor, orgId, null, {
        provider: 'google',
        mailboxesCreated: created.length,
        domainsFiltered: allowedDomains,
      });
    }

    return {
      mailboxesCreated: created.length,
      mailboxesDiscovered: users.length,
      provider: 'google',
    };
  }

  async getStatus(): Promise<ProviderStatusResponse> {
    const mailboxCount = await this.mailboxRepo.count();
    if (mailboxCount === 0) return { connected: false, mailboxCount: 0, syncStatus: 'not_started' };

    const [first] = await this.mailboxRepo.findAll({ limit: 1 });
    const provider = first?.provider as 'm365' | 'google' | undefined;

    // Use a single aggregate query — avoids loading potentially thousands of rows.
    const syncStatus = await this.mailboxRepo.getSyncStatus();

    return { connected: true, provider, mailboxCount, syncStatus };
  }

  /**
   * @param mailboxIds When provided, restricts the directory sync to refreshing
   * only these existing mailboxes (no new mailboxes are discovered/created,
   * since a scoped selection can only reference mailboxes that already exist).
   */
  async resync(
    mailboxIds?: string[],
    actor?: AuditActor,
  ): Promise<{ created: number; updated: number; errors: string[] }> {
    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured');

    const allowedDomains = org.domains
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);

    let allowedAddresses: Set<string> | undefined;
    if (mailboxIds?.length) {
      const scoped = await Promise.all(mailboxIds.map((id) => this.mailboxRepo.findById(id)));
      allowedAddresses = new Set(
        scoped.filter((m) => m != null).map((m) => m.address.toLowerCase()),
      );
    }

    let created = 0,
      updated = 0;
    const errors: string[] = [];

    // M365 — driven by the presence of stored mail credentials, independent of
    // the SSO `enabled` flag (email ingestion and SSO login are separate concerns).
    const m365 = await this.authProviderRepo.findWithSecret('m365');
    if (m365?.tenantId && m365.clientId && m365.clientSecret) {
      try {
        const users = await listAllM365Users(
          m365.tenantId,
          m365.clientId,
          m365.clientSecret,
          allowedDomains,
        );
        const scoped = allowedAddresses
          ? users.filter((u) => allowedAddresses!.has(u.email.toLowerCase()))
          : users;
        const stats = await this.upsertDirectoryUsers(scoped, 'm365', org.id, !allowedAddresses);
        created += stats.created;
        updated += stats.updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err }, 'resync: M365 directory sync failed');
        errors.push(`M365: ${msg}`);
        await this.alerts?.record({
          orgId: org.id,
          severity: 'critical',
          category: 'Directory Sync',
          title: 'M365 directory re-sync failed',
          description: msg,
          source: actor?.actorEmail ?? 'System',
        });
      }
    }

    // Google directory configuration is provider-specific. It must not fall
    // back to the Insight Hub administrator, who may not be a Workspace admin.
    const goog = await this.authProviderRepo.findWithSecret('google');
    if (goog?.serviceAccountJson && goog.googleAdminEmail && goog.googleCustomerId) {
      try {
        const users = await listAllGoogleUsers(
          goog.serviceAccountJson,
          goog.googleAdminEmail,
          goog.googleCustomerId,
          allowedDomains,
        );
        const scoped = allowedAddresses
          ? users.filter((u) => allowedAddresses!.has(u.email.toLowerCase()))
          : users;
        const stats = await this.upsertDirectoryUsers(scoped, 'google', org.id, !allowedAddresses);
        created += stats.created;
        updated += stats.updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        logger.error({ err }, 'resync: Google directory sync failed');
        errors.push(`Google: ${msg}`);
        await this.alerts?.record({
          orgId: org.id,
          severity: 'critical',
          category: 'Directory Sync',
          title: 'Google directory re-sync failed',
          description: msg,
          source: actor?.actorEmail ?? 'System',
        });
      }
    }

    return { created, updated, errors };
  }

  // Private

  private async upsertDirectoryUsers(
    users: Array<{
      id: string;
      email: string;
      displayName: string;
      givenName: string;
      familyName: string;
      jobTitle: string | null;
      department: string | null;
      photoData: string | null;
    }>,
    provider: 'm365' | 'google',
    orgId: string,
    allowCreate: boolean = true,
  ): Promise<{ created: number; updated: number }> {
    let created = 0,
      updated = 0;

    for (const u of users) {
      const existing = await this.mailboxRepo.findByAddress(u.email);

      if (existing) {
        await this.mailboxRepo.updateProfile(existing.id, {
          displayName: u.displayName || null,
          givenName: u.givenName || null,
          familyName: u.familyName || null,
          jobTitle: u.jobTitle,
          departmentName: u.department,
        });
        await this.savePhoto(existing.id, u.photoData);
        if (this.userRepo) {
          const user = existing.ownerUserId
            ? await this.userRepo.findById(existing.ownerUserId)
            : await this.userRepo.findByEmail(u.email);
          if (user) {
            if (!existing.ownerUserId) await this.mailboxRepo.linkOwner(existing.id, user.id);
            // Keep the platform account's name in sync with the directory —
            // no manual edit needed when the provider's profile changes.
            if (u.displayName && u.displayName !== user.displayName) {
              await this.userRepo.updateUser(user.id, { displayName: u.displayName });
            }
          }
        }
        updated++;
      } else if (allowCreate) {
        let ownerUserId: string | null = null;
        if (this.userRepo) {
          const user = await this.userRepo.findByEmail(u.email);
          ownerUserId = user?.id ?? null;
        }
        const createdMailbox = await this.mailboxRepo.create({
          orgId,
          address: u.email,
          provider,
          providerUserId: u.id,
          displayName: u.displayName || null,
          givenName: u.givenName || null,
          familyName: u.familyName || null,
          jobTitle: u.jobTitle,
          departmentName: u.department,
          ownerUserId,
        });
        await this.savePhoto(createdMailbox.id, u.photoData);
        await this.queueInitialSyncs([createdMailbox]);
        created++;
      }
    }

    return { created, updated };
  }

  private async linkMailboxesToUsers(mailboxes: { id: string; address: string }[]): Promise<void> {
    if (!this.userRepo) return;
    await Promise.allSettled(
      mailboxes.map(async ({ id, address }) => {
        const user = await this.userRepo!.findByEmail(address);
        if (user) await this.mailboxRepo.linkOwner(id, user.id);
      }),
    );
  }
}
