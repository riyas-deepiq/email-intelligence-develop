import { ValidationError } from '../../lib/errors';

type Body = Record<string, unknown>;

function requireStr(b: Body, field: string, minLen = 1): string {
  const v = b[field];
  if (typeof v !== 'string' || v.length < minLen) {
    throw new ValidationError(`${field} is required (min ${minLen} characters)`);
  }
  return v;
}

function validateNewPassword(pwd: string): string {
  if (pwd.length < 8) throw new ValidationError('Password must be at least 8 characters');
  if (!/[a-z]/.test(pwd))
    throw new ValidationError('Password must contain at least one lowercase letter');
  if (!/[A-Z]/.test(pwd))
    throw new ValidationError('Password must contain at least one uppercase letter');
  if (!/[0-9!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(pwd))
    throw new ValidationError('Password must contain at least one number or special character');
  return pwd;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export interface LoginDto {
  email: string;
  password: string;
}
export interface RefreshDto {
  refreshToken: string;
}
export interface SetupDto {
  companyName: string;
  domains: string;
  email: string;
  newPassword: string;
}
export interface ForgotPasswordDto {
  email: string;
}
export interface ResetPasswordDto {
  token: string;
  newPassword: string;
}
export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}
export interface AcceptInviteDto {
  token: string;
  newPassword: string;
}

export function parseLoginDto(body: unknown): LoginDto {
  const b = (body ?? {}) as Body;
  const email = requireStr(b, 'email');
  if (!isEmail(email)) throw new ValidationError('email must be a valid email address');
  return { email, password: requireStr(b, 'password') };
}

export function parseRefreshDto(body: unknown): RefreshDto {
  const b = (body ?? {}) as Body;
  return { refreshToken: requireStr(b, 'refreshToken') };
}

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

function parseDomains(raw: string): string {
  const segments = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) throw new ValidationError('domains must contain at least one domain');
  for (const d of segments) {
    if (!DOMAIN_RE.test(d)) throw new ValidationError(`"${d}" is not a valid domain name`);
  }
  return segments.join(',');
}

export function parseSetupDto(body: unknown): SetupDto {
  const b = (body ?? {}) as Body;
  const email = requireStr(b, 'email');
  if (!isEmail(email)) throw new ValidationError('email must be a valid email address');
  return {
    companyName: requireStr(b, 'companyName'),
    domains: parseDomains(requireStr(b, 'domains')),
    email,
    newPassword: validateNewPassword(requireStr(b, 'newPassword', 1)),
  };
}

export function parseForgotPasswordDto(body: unknown): ForgotPasswordDto {
  const b = (body ?? {}) as Body;
  const email = requireStr(b, 'email');
  if (!isEmail(email)) throw new ValidationError('email must be a valid email address');
  return { email };
}

export function parseResetPasswordDto(body: unknown): ResetPasswordDto {
  const b = (body ?? {}) as Body;
  return {
    token: requireStr(b, 'token'),
    newPassword: validateNewPassword(requireStr(b, 'newPassword', 1)),
  };
}

export function parseChangePasswordDto(body: unknown): ChangePasswordDto {
  const b = (body ?? {}) as Body;
  return {
    currentPassword: requireStr(b, 'currentPassword'),
    newPassword: validateNewPassword(requireStr(b, 'newPassword', 1)),
  };
}

export function parseAcceptInviteDto(body: unknown): AcceptInviteDto {
  const b = (body ?? {}) as Body;
  return {
    token: requireStr(b, 'token'),
    newPassword: validateNewPassword(requireStr(b, 'newPassword', 1)),
  };
}
