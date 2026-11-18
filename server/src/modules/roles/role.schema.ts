import { ValidationError } from '../../lib/errors';
import { knownPermissionIds } from './permission-catalog';
import type { AssignUserRoleInput, CreateRoleInput, UpdateRoleInput } from './role.types';

const BASE_ROLES = ['employee', 'admin'] as const;

function readString(
  body: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; min?: number; max?: number } = {},
): string | undefined {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    if (opts.required) throw new ValidationError(`${key} is required`);
    return undefined;
  }
  if (typeof raw !== 'string') throw new ValidationError(`${key} must be a string`);
  const value = raw.trim();
  if (opts.required && value.length === 0) throw new ValidationError(`${key} is required`);
  if (opts.min != null && value.length < opts.min)
    throw new ValidationError(`${key} must be at least ${opts.min} characters`);
  if (opts.max != null && value.length > opts.max)
    throw new ValidationError(`${key} must be at most ${opts.max} characters`);
  return value;
}

function readBaseRole(value: unknown): CreateRoleInput['baseRole'] {
  if (!BASE_ROLES.includes(value as CreateRoleInput['baseRole'])) {
    throw new ValidationError(`baseRole must be one of: ${BASE_ROLES.join(', ')}`);
  }
  return value as CreateRoleInput['baseRole'];
}

function readPermissions(value: unknown, required = true): string[] | undefined {
  if (value === undefined || value === null) {
    if (required) throw new ValidationError('permissions is required');
    return undefined;
  }
  if (!Array.isArray(value)) throw new ValidationError('permissions must be an array');
  const known = knownPermissionIds();
  const deduped: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !known.has(item)) {
      throw new ValidationError('permissions contains an unknown permission');
    }
    if (!deduped.includes(item)) deduped.push(item);
  }
  return deduped;
}

export function parseCreateRoleDto(body: unknown): CreateRoleInput {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    name: readString(b, 'name', { required: true, min: 2, max: 60 })!,
    description: readString(b, 'description', { max: 180 }) ?? '',
    baseRole: readBaseRole(b['baseRole']),
    permissions: readPermissions(b['permissions'])!,
  };
}

export function parseUpdateRoleDto(body: unknown): UpdateRoleInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const dto: UpdateRoleInput = {};

  const name = readString(b, 'name', { min: 2, max: 60 });
  if (name !== undefined) dto.name = name;

  const description = readString(b, 'description', { max: 180 });
  if (description !== undefined) dto.description = description;

  if (b['baseRole'] !== undefined) dto.baseRole = readBaseRole(b['baseRole']);

  const permissions = readPermissions(b['permissions'], false);
  if (permissions !== undefined) dto.permissions = permissions;

  if (Object.keys(dto).length === 0) {
    throw new ValidationError('At least one role field must be provided');
  }

  return dto;
}

export function parseAssignUserRoleDto(body: unknown): AssignUserRoleInput {
  const b = (body ?? {}) as Record<string, unknown>;
  const roleId = readString(b, 'roleId', { max: 80 });
  const systemRole = b['systemRole'] === undefined ? undefined : readBaseRole(b['systemRole']);

  if (roleId && systemRole) {
    throw new ValidationError('Provide either roleId or systemRole, not both');
  }
  if (!roleId && !systemRole) {
    throw new ValidationError('roleId or systemRole is required');
  }

  return roleId ? { roleId } : { systemRole };
}
