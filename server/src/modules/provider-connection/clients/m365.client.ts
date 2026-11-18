import { logger } from '../../../lib/logger';

export interface M365User {
  id: string;
  email: string;
  displayName: string;
  givenName: string;
  familyName: string;
  jobTitle: string | null;
  department: string | null;
  photoData: string | null;
}

export interface M365TestResult {
  valid: boolean;
  canListUsers: boolean;
  canReadMail: boolean;
  userCount: number;
  sampleUsers: Pick<M365User, 'email' | 'displayName'>[];
  error?: string;
}

interface GraphTokenResponse {
  access_token: string;
}

async function getAccessToken(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Token request failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as GraphTokenResponse;
  return data.access_token;
}

async function fetchUserPhoto(userId: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${userId}/photo/$value`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return `data:image/jpeg;base64,${Buffer.from(buf).toString('base64')}`;
  } catch {
    return null;
  }
}

export async function testM365Connection(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<M365TestResult> {
  let token: string;
  try {
    token = await getAccessToken(tenantId, clientId, clientSecret);
  } catch (err) {
    return {
      valid: false,
      canListUsers: false,
      canReadMail: false,
      userCount: 0,
      sampleUsers: [],
      error: err instanceof Error ? err.message : 'Authentication failed',
    };
  }

  const headers = { Authorization: `Bearer ${token}` };

  let usersRes: Response;
  try {
    usersRes = await fetch(
      'https://graph.microsoft.com/v1.0/users?$select=id,displayName,mail,userPrincipalName&$top=5&$count=true',
      {
        headers: { ...headers, ConsistencyLevel: 'eventual' },
        signal: AbortSignal.timeout(10_000),
      },
    );
  } catch (err) {
    return {
      valid: false,
      canListUsers: false,
      canReadMail: false,
      userCount: 0,
      sampleUsers: [],
      error:
        err instanceof Error ? `Graph API unreachable: ${err.message}` : 'Graph API unreachable',
    };
  }

  if (!usersRes.ok) {
    const msg =
      usersRes.status === 403
        ? 'User.Read.All permission is missing — grant it in Azure AD app registration'
        : `Graph /users returned ${usersRes.status}`;
    return {
      valid: false,
      canListUsers: false,
      canReadMail: false,
      userCount: 0,
      sampleUsers: [],
      error: msg,
    };
  }

  const usersData = (await usersRes.json()) as {
    '@odata.count'?: number;
    value: { id: string; displayName: string; mail?: string; userPrincipalName?: string }[];
  };

  const sampleUsers = usersData.value.map((u) => ({
    email: u.mail ?? u.userPrincipalName ?? '',
    displayName: u.displayName ?? '',
  }));

  let canReadMail = false;
  try {
    const mailRes = await fetch(
      'https://graph.microsoft.com/v1.0/users?$filter=assignedLicenses/$count ne 0&$count=true&$select=id&$top=1',
      {
        headers: { ...headers, ConsistencyLevel: 'eventual' },
        signal: AbortSignal.timeout(10_000),
      },
    );
    canReadMail = mailRes.ok;
  } catch {
    canReadMail = false;
  }

  return {
    valid: true,
    canListUsers: true,
    canReadMail,
    userCount: usersData['@odata.count'] ?? usersData.value.length,
    sampleUsers,
  };
}

export async function listAllM365Users(
  tenantId: string,
  clientId: string,
  clientSecret: string,
  allowedDomains?: string[],
): Promise<M365User[]> {
  const token = await getAccessToken(tenantId, clientId, clientSecret);
  const headers = { Authorization: `Bearer ${token}` };

  const rawUsers: {
    id: string;
    displayName: string;
    givenName?: string;
    surname?: string;
    jobTitle?: string;
    department?: string;
    mail?: string;
    userPrincipalName?: string;
  }[] = [];
  let url: string | null =
    'https://graph.microsoft.com/v1.0/users?$select=id,displayName,givenName,surname,jobTitle,department,mail,userPrincipalName&$top=999';

  while (url) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Graph /users page failed: ${res.status}`);
    const data = (await res.json()) as {
      '@odata.nextLink'?: string;
      value: typeof rawUsers;
    };
    rawUsers.push(...data.value);
    url = data['@odata.nextLink'] ?? null;
  }

  // Always drop accounts that aren't real internal mailboxes: those with no
  // address, and guest/external accounts (their UPN contains the #EXT# marker).
  const internal = rawUsers.filter((u) => {
    const email = u.mail ?? u.userPrincipalName ?? '';
    if (!email) return false;
    if ((u.userPrincipalName ?? '').includes('#EXT#')) return false;
    return true;
  });

  // Apply the org domain allow-list strictly: a mailbox from a domain the org
  // hasn't configured must never be imported, even if that means zero matches.
  // (Previously this fell back to importing every mailbox in the tenant when
  // nothing matched — which meant a tenant hosting multiple companies' mail
  // would leak other domains' mailboxes into an org that never asked for them.)
  let selected = internal;
  if (allowedDomains && allowedDomains.length > 0) {
    selected = internal.filter((u) => {
      const domain = (u.mail ?? u.userPrincipalName ?? '').split('@')[1]?.toLowerCase() ?? '';
      return allowedDomains.includes(domain);
    });
    if (selected.length === 0) {
      logger.warn({ allowedDomains }, 'No M365 mailboxes matched the configured org domains');
    }
  }

  const users: M365User[] = selected.map((u) => ({
    id: u.id,
    email: (u.mail ?? u.userPrincipalName ?? '').toLowerCase(),
    displayName: u.displayName ?? '',
    givenName: u.givenName ?? '',
    familyName: u.surname ?? '',
    jobTitle: u.jobTitle ?? null,
    department: u.department ?? null,
    photoData: null,
  }));

  // Fetch photos in batches of 20 (best-effort, failures → null)
  const BATCH = 20;
  for (let i = 0; i < users.length; i += BATCH) {
    const batch = users.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((u) => fetchUserPhoto(u.id, token)));
    results.forEach((r, idx) => {
      batch[idx].photoData = r.status === 'fulfilled' ? r.value : null;
    });
  }

  return users;
}
