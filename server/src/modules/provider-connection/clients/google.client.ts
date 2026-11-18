import { google, type admin_directory_v1, type gmail_v1 } from 'googleapis';
import { logger } from '../../../lib/logger';

export const GOOGLE_DIRECTORY_SCOPE =
  'https://www.googleapis.com/auth/admin.directory.user.readonly';
export const GOOGLE_MAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export interface GoogleUser {
  id: string;
  email: string;
  displayName: string;
  givenName: string;
  familyName: string;
  jobTitle: string | null;
  department: string | null;
  photoData: string | null;
}

export interface GoogleTestResult {
  valid: boolean;
  canListUsers: boolean;
  canReadMail: boolean;
  userCount: number;
  sampleUsers: Pick<GoogleUser, 'email' | 'displayName'>[];
  error?: string;
}

interface ServiceAccountKey {
  client_email: string;
  client_id: string;
  private_key: string;
}

type DirectoryUser = admin_directory_v1.Schema$User;

function parseServiceAccountKey(serviceAccountJson: string): ServiceAccountKey {
  const key = JSON.parse(serviceAccountJson) as Partial<ServiceAccountKey>;
  if (!key.client_email || !key.client_id || !key.private_key) {
    throw new Error('Service account JSON is missing client_email, client_id, or private_key');
  }
  return key as ServiceAccountKey;
}

function buildAdminClient(
  serviceAccountJson: string,
  adminEmail: string,
): admin_directory_v1.Admin {
  const key = parseServiceAccountKey(serviceAccountJson);
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [GOOGLE_DIRECTORY_SCOPE],
    subject: adminEmail,
  });
  return google.admin({ version: 'directory_v1', auth });
}

function buildGmailClient(serviceAccountJson: string, userEmail: string): gmail_v1.Gmail {
  const key = parseServiceAccountKey(serviceAccountJson);
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [GOOGLE_MAIL_SCOPE],
    subject: userEmail,
  });
  return google.gmail({ version: 'v1', auth });
}

function isActiveMailbox(user: DirectoryUser): boolean {
  return !!user.primaryEmail && user.isMailboxSetup !== false && !user.suspended && !user.archived;
}

async function listDirectoryUsers(
  admin: admin_directory_v1.Admin,
  customerId: string,
): Promise<DirectoryUser[]> {
  const users: DirectoryUser[] = [];
  let pageToken: string | undefined;

  do {
    const res = await admin.users.list({
      customer: customerId || 'my_customer',
      maxResults: 500,
      pageToken,
      projection: 'full',
      fields:
        'nextPageToken,users(id,primaryEmail,name,organizations,isMailboxSetup,suspended,archived)',
    });
    users.push(...(res.data.users ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return users;
}

function googleErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : 'Unknown Google API error';
  if (/invalid_grant/i.test(message)) {
    return 'Google delegation failed — verify the delegated admin email, service-account client ID, and domain-wide delegation';
  }
  if (/unauthorized|forbidden|403/i.test(message)) {
    return 'Google API permission denied — verify domain-wide delegation and the required OAuth scopes';
  }
  return message;
}

async function fetchGooglePhoto(
  admin: admin_directory_v1.Admin,
  userKey: string,
): Promise<string | null> {
  try {
    const res = await admin.users.photos.get({ userKey });
    const raw = res.data.photoData;
    if (!raw) return null;
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const mime = res.data.mimeType?.toLowerCase().replace('jpeg', 'jpg') ?? 'jpeg';
    return `data:image/${mime === 'jpg' ? 'jpeg' : mime};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function testGoogleConnection(
  serviceAccountJson: string,
  adminEmail: string,
  customerId: string,
): Promise<GoogleTestResult> {
  let directoryUsers: DirectoryUser[];
  try {
    const admin = buildAdminClient(serviceAccountJson, adminEmail);
    directoryUsers = (await listDirectoryUsers(admin, customerId)).filter(isActiveMailbox);
  } catch (err: unknown) {
    return {
      valid: false,
      canListUsers: false,
      canReadMail: false,
      userCount: 0,
      sampleUsers: [],
      error: googleErrorMessage(err),
    };
  }

  const sampleUsers = directoryUsers.slice(0, 5).map((u) => ({
    email: u.primaryEmail ?? '',
    displayName: u.name?.fullName ?? '',
  }));
  const mailboxToTest = directoryUsers[0]?.primaryEmail;
  if (!mailboxToTest) {
    return {
      valid: false,
      canListUsers: true,
      canReadMail: false,
      userCount: 0,
      sampleUsers: [],
      error: 'Directory access succeeded, but no active Gmail-enabled users were found',
    };
  }

  try {
    const gmail = buildGmailClient(serviceAccountJson, mailboxToTest);
    await gmail.users.getProfile({ userId: 'me' });
  } catch (err: unknown) {
    return {
      valid: false,
      canListUsers: true,
      canReadMail: false,
      userCount: directoryUsers.length,
      sampleUsers,
      error: `Directory access succeeded, but Gmail access failed for ${mailboxToTest}: ${googleErrorMessage(err)}`,
    };
  }

  return {
    valid: true,
    canListUsers: true,
    canReadMail: true,
    userCount: directoryUsers.length,
    sampleUsers,
  };
}

export async function listAllGoogleUsers(
  serviceAccountJson: string,
  adminEmail: string,
  customerId: string,
  allowedDomains?: string[],
): Promise<GoogleUser[]> {
  const admin = buildAdminClient(serviceAccountJson, adminEmail);
  const directoryUsers = await listDirectoryUsers(admin, customerId);
  let users: GoogleUser[] = directoryUsers.filter(isActiveMailbox).map((u) => {
    const email = u.primaryEmail!.toLowerCase();
    const org = (
      u.organizations as Array<{ title?: string; department?: string }> | undefined
    )?.[0];
    return {
      id: u.id ?? '',
      email,
      displayName: u.name?.fullName ?? email,
      givenName: u.name?.givenName ?? '',
      familyName: u.name?.familyName ?? '',
      jobTitle: org?.title ?? null,
      department: org?.department ?? null,
      photoData: null,
    };
  });

  if (allowedDomains?.length) {
    users = users.filter((u) =>
      allowedDomains.includes(u.email.split('@')[1]?.toLowerCase() ?? ''),
    );
    if (users.length === 0) {
      logger.warn({ allowedDomains }, 'No Google mailboxes matched the configured org domains');
    }
  }

  const batchSize = 20;
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((user) => fetchGooglePhoto(admin, user.email)),
    );
    results.forEach((result, index) => {
      batch[index]!.photoData = result.status === 'fulfilled' ? result.value : null;
    });
  }

  return users;
}
