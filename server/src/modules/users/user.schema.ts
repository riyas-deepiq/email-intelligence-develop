import { ValidationError } from '../../lib/errors';
import type { UserRole } from './user.types';

const MANAGEABLE_ROLES: UserRole[] = ['employee', 'admin'];

export interface CreateUserDto {
  email: string;
  displayName: string;
  role?: UserRole;
}

export interface UpdateUserDto {
  displayName?: string;
  email?: string;
  role?: UserRole;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function parseUpdateUserDto(body: unknown): UpdateUserDto {
  const b = (body ?? {}) as Record<string, unknown>;
  const dto: UpdateUserDto = {};

  if (b['displayName'] !== undefined) {
    if (
      typeof b['displayName'] !== 'string' ||
      b['displayName'].trim().length < 1 ||
      b['displayName'].length > 120
    ) {
      throw new ValidationError('displayName must be between 1 and 120 characters');
    }
    dto.displayName = b['displayName'].trim();
  }

  if (b['email'] !== undefined) {
    if (typeof b['email'] !== 'string' || !isEmail(b['email'])) {
      throw new ValidationError('email must be a valid email address');
    }
    dto.email = b['email'];
  }

  if (b['role'] !== undefined) {
    const allowed: UserRole[] = ['employee', 'admin'];
    if (!allowed.includes(b['role'] as UserRole)) {
      throw new ValidationError(`role must be one of: ${allowed.join(', ')}`);
    }
    dto.role = b['role'] as UserRole;
  }

  if (!dto.displayName && !dto.email && !dto.role) {
    throw new ValidationError('At least one of displayName, email, or role must be provided');
  }

  return dto;
}

export interface InviteUserDto {
  email: string;
}

export function parseInviteUserDto(body: unknown): InviteUserDto {
  const b = (body ?? {}) as Record<string, unknown>;

  const email = b['email'];
  if (typeof email !== 'string' || !isEmail(email)) {
    throw new ValidationError('email must be a valid email address');
  }
  if (b['role'] !== undefined || b['roleId'] !== undefined || b['displayName'] !== undefined) {
    throw new ValidationError('Invited users are employees; only email is accepted');
  }
  return { email: email.trim().toLowerCase() };
}

export function parseCreateUserDto(body: unknown): CreateUserDto {
  const b = (body ?? {}) as Record<string, unknown>;

  const email = b['email'];
  if (typeof email !== 'string' || !isEmail(email)) {
    throw new ValidationError('email must be a valid email address');
  }

  const displayName = b['displayName'];
  if (typeof displayName !== 'string' || displayName.length < 1 || displayName.length > 120) {
    throw new ValidationError('displayName must be between 1 and 120 characters');
  }

  let role: UserRole | undefined;
  if (b['role'] !== undefined) {
    if (!MANAGEABLE_ROLES.includes(b['role'] as UserRole)) {
      throw new ValidationError(`role must be one of: ${MANAGEABLE_ROLES.join(', ')}`);
    }
    role = b['role'] as UserRole;
  }

  return { email, displayName, role };
}
