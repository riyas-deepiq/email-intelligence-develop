import { ValidationError } from '../../lib/errors';
import { ALL_PROVIDERS, type ProviderType } from './auth-provider.types';

type Body = Record<string, unknown>;

function isUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

function optionalStr(b: Body, field: string): string | null | undefined {
  const v = b[field];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new ValidationError(`${field} must be a string or null`);
  if (v.length === 0) throw new ValidationError(`${field} must not be empty`);
  return v;
}

export interface UpdateAuthProviderDto {
  enabled: boolean;
  tenantId?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  redirectUri?: string | null;
}

export function parseProviderParam(params: Record<string, string>): { provider: ProviderType } {
  const provider = params['provider'] as ProviderType;
  if (!ALL_PROVIDERS.includes(provider)) {
    throw new ValidationError(`provider must be one of: ${ALL_PROVIDERS.join(', ')}`);
  }
  return { provider };
}

export function parseUpdateAuthProviderDto(body: unknown): UpdateAuthProviderDto {
  const b = (body ?? {}) as Body;
  if (typeof b['enabled'] !== 'boolean') throw new ValidationError('enabled must be a boolean');

  const dto: UpdateAuthProviderDto = { enabled: b['enabled'] };

  const tenantId = optionalStr(b, 'tenantId');
  if (tenantId !== undefined) dto.tenantId = tenantId;

  const clientId = optionalStr(b, 'clientId');
  if (clientId !== undefined) dto.clientId = clientId;

  const clientSecret = optionalStr(b, 'clientSecret');
  if (clientSecret !== undefined) dto.clientSecret = clientSecret;

  const redirectUri = optionalStr(b, 'redirectUri');
  if (redirectUri !== undefined) {
    if (redirectUri !== null && !isUrl(redirectUri)) {
      throw new ValidationError('redirectUri must be a valid URL');
    }
    dto.redirectUri = redirectUri;
  }

  return dto;
}
