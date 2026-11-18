import { ValidationError } from '../../lib/errors';
import type { ConnectPayload, TestConnectionPayload } from './provider-connection.types';

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function parseTestPayload(body: unknown): TestConnectionPayload {
  const b = (body ?? {}) as Record<string, unknown>;
  const provider = b['provider'];

  if (provider === 'm365') {
    if (!isNonEmptyString(b['tenantId'])) throw new ValidationError('tenantId is required');
    if (!isNonEmptyString(b['clientId'])) throw new ValidationError('clientId is required');
    // clientSecret is optional: when left blank the previously-saved secret is reused
    // (validated server-side, which has access to the stored credential).

    // SSRF guard: tenantId must be a UUID or simple domain slug
    if (!/^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,251}[a-zA-Z0-9])?$/.test(b['tenantId'] as string)) {
      throw new ValidationError('tenantId must be alphanumeric (UUID or domain slug)');
    }

    return {
      provider: 'm365',
      tenantId: (b['tenantId'] as string).trim(),
      clientId: (b['clientId'] as string).trim(),
      clientSecret: isNonEmptyString(b['clientSecret']) ? (b['clientSecret'] as string).trim() : '',
    };
  }

  if (provider === 'google') {
    if (!isNonEmptyString(b['adminEmail'])) throw new ValidationError('adminEmail is required');
    if (!isEmail(b['adminEmail'] as string))
      throw new ValidationError('adminEmail must be a valid email address');

    // `domain` is accepted as a compatibility fallback for clients predating
    // customer-wide discovery. New clients send `my_customer` (or the stable
    // Workspace customer ID), which includes secondary domains too.
    const rawCustomerId = isNonEmptyString(b['customerId'])
      ? (b['customerId'] as string)
      : isNonEmptyString(b['domain'])
        ? (b['domain'] as string)
        : 'my_customer';
    const customerId = rawCustomerId.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(customerId)) {
      throw new ValidationError('customerId contains unsupported characters');
    }

    const serviceAccountJson = isNonEmptyString(b['serviceAccountJson'])
      ? (b['serviceAccountJson'] as string).trim()
      : '';
    if (serviceAccountJson) {
      // The Client ID is needed by the Workspace administrator when granting
      // domain-wide delegation, even though token signing uses email + key.
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(serviceAccountJson) as Record<string, unknown>;
      } catch {
        throw new ValidationError('serviceAccountJson must be valid JSON');
      }
      if (!parsed['client_email'] || !parsed['private_key'] || !parsed['client_id']) {
        throw new ValidationError(
          'serviceAccountJson must contain client_email, client_id, and private_key fields',
        );
      }
    }

    return {
      provider: 'google',
      serviceAccountJson,
      adminEmail: (b['adminEmail'] as string).trim(),
      customerId,
    };
  }

  throw new ValidationError('provider must be "m365" or "google"');
}

export function parseConnectPayload(body: unknown): ConnectPayload {
  const base = parseTestPayload(body);
  const b = (body ?? {}) as Record<string, unknown>;
  if (b['confirmed'] !== true) {
    throw new ValidationError('confirmed must be true to proceed with connection');
  }
  return { ...base, confirmed: true };
}
