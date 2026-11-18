import type { AuthProviderRepository } from '../auth-providers/auth-provider.repository';
import type { MailboxRepository } from '../mailboxes/mailbox.repository';
import type { OrgRepository } from '../organizations/org.repository';
import type { UserRepository } from '../users/user.repository';

export type SetupStepKey = 'organization' | 'admin' | 'sso' | 'mailboxes';

export interface SetupStep {
  done: boolean;
  optional: boolean;
  skipped?: boolean;
}

export interface SetupStatus {
  complete: boolean;
  redirectTo: string | null;
  steps: Record<SetupStepKey, SetupStep>;
}

export class SetupService {
  constructor(
    private readonly orgRepo: OrgRepository,
    private readonly userRepo: UserRepository,
    private readonly providerRepo: AuthProviderRepository,
    private readonly mailboxRepo: MailboxRepository,
  ) {}

  async getStatus(): Promise<SetupStatus> {
    const [org, users, providers, mailboxCount] = await Promise.all([
      this.orgRepo.findFirst(),
      this.userRepo.findAll(),
      this.providerRepo.findAll(),
      this.mailboxRepo.count(),
    ]);

    const orgDone = org != null;
    const adminDone = users.some((u) => u.role === 'superadmin' && u.status === 'active');
    const ssoSkipped = org?.ssoSkipped ?? false;
    const ssoDone =
      ssoSkipped ||
      providers.some((p) => (p.provider === 'm365' || p.provider === 'google') && p.enabled);
    const mailboxesDone = mailboxCount > 0;

    const steps: Record<SetupStepKey, SetupStep> = {
      organization: { done: orgDone, optional: false },
      admin: { done: adminDone, optional: false },
      sso: { done: ssoDone, optional: true, skipped: ssoSkipped },
      mailboxes: { done: mailboxesDone, optional: false },
    };

    const complete = orgDone && adminDone && ssoDone && mailboxesDone;

    let redirectTo: string | null = null;
    if (!complete) {
      if (!orgDone) redirectTo = '/setup/organization';
      else if (!adminDone) redirectTo = '/setup/admin';
      else if (!ssoDone) redirectTo = '/setup/sso';
      else redirectTo = '/setup/mailboxes';
    }

    return { complete, redirectTo, steps };
  }
}
