import { ValidationError } from '../../lib/errors';
import type { MailboxProvider, UpdateMailboxSyncConfigInput } from './mailbox.types';

const PROVIDERS: MailboxProvider[] = ['m365', 'google'];

export interface CreateMailboxDto {
  address: string;
  provider: MailboxProvider;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function parseCreateMailboxDto(body: unknown): CreateMailboxDto {
  const b = (body ?? {}) as Record<string, unknown>;
  const address = b['address'];
  if (typeof address !== 'string' || !isEmail(address)) {
    throw new ValidationError('address must be a valid email address');
  }
  const provider = b['provider'] as MailboxProvider;
  if (!PROVIDERS.includes(provider)) {
    throw new ValidationError(`provider must be one of: ${PROVIDERS.join(', ')}`);
  }
  return { address, provider };
}

export function parseUpdateMailboxSyncConfigDto(body: unknown): UpdateMailboxSyncConfigInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const dto: UpdateMailboxSyncConfigInput = {};

  if ('syncEnabled' in b) {
    if (typeof b['syncEnabled'] !== 'boolean')
      throw new ValidationError('syncEnabled must be a boolean');
    dto.syncEnabled = b['syncEnabled'];
  }

  if ('syncPriority' in b) {
    const p = b['syncPriority'];
    if (typeof p !== 'number' || !Number.isInteger(p))
      throw new ValidationError('syncPriority must be an integer');
    dto.syncPriority = p;
  }

  if ('syncFromDate' in b) {
    const d = b['syncFromDate'];
    if (d !== null && d !== undefined) {
      if (typeof d !== 'string' || isNaN(Date.parse(d)))
        throw new ValidationError('syncFromDate must be an ISO date string or null');
      dto.syncFromDate = d;
    } else {
      dto.syncFromDate = null;
    }
  }

  if (Object.keys(dto).length === 0)
    throw new ValidationError(
      'At least one field (syncEnabled, syncPriority, syncFromDate) is required',
    );

  return dto;
}
