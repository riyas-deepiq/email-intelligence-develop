/**
 * Helpers for the organisation's allowed-domains list. The org stores domains as
 * a comma-separated string (e.g. "acme.com, acme.io"); only users whose email
 * domain is in this list may belong to the platform.
 */

/** Parses the comma-separated org domains into a normalised lowercase list. */
export function parseOrgDomains(domains: string): string[] {
  return domains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true when the email's domain is allowed by the org's domain list.
 * An empty/unconfigured domain list imposes no restriction.
 */
export function isEmailDomainAllowed(email: string, orgDomains: string): boolean {
  const allowed = parseOrgDomains(orgDomains);
  if (allowed.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return allowed.includes(domain);
}
