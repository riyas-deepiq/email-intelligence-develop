import type { UserRole } from '../users/user.types';

/** The subset of user data attached to every authenticated request. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  sessionId: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface LoginResponse {
  user: Omit<SessionUser, 'sessionId'> & { mailboxId: string | null };
  tokens: TokenPair;
  isFirstLogin?: boolean;
}

export interface SetupRequest {
  companyName: string;
  domains: string;
  email: string;
  newPassword: string;
}

export interface SetupResponse {
  tokens: TokenPair;
  user: Omit<SessionUser, 'sessionId'> & { mailboxId: string | null };
}
