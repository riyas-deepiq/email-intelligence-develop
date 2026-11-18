import { Role } from '@/shared/types/enums';
export { Role };

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  roleId: string | null;
  roleName: string | null;
  permissions: string[];
  mailboxId: string | null;
}

export interface MeResponse extends User {
  isFirstLogin?: boolean;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface TokenPair {
  accessToken: string;
  /** Present in legacy API responses; omitted when the server uses HttpOnly cookies. */
  refreshToken?: string;
  expiresIn: string;
}

export interface AuthResponse {
  user: User;
  tokens: TokenPair;
  isFirstLogin?: boolean;
}

export interface SetupPayload {
  companyName: string;
  domains: string;
  email: string;
  newPassword: string;
}

export interface SetupResponse {
  message: string;
  tokens: TokenPair;
  user: User;
}

export interface OidcExchangeResponse {
  tokens: TokenPair;
  user: User;
}

export interface SessionEntry {
  sessionId: string;
  expiresAt: string;
  deviceName: string;
}
