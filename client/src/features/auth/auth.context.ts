import { createContext } from 'react';
import type { LoginPayload, TokenPair, User } from './auth.types';

export interface AuthContextValue {
  user: User | null;
  loading: boolean;
  requiresSetup: boolean;
  login: (payload: LoginPayload) => Promise<{ requiresSetup: boolean }>;
  loginFromOidc: (tokens: TokenPair, oidcUser: User) => void;
  logout: () => Promise<void>;
  completeSetup: (tokens: TokenPair, updatedUser: User) => void;
  updateProfile: (patch: { displayName?: string; email?: string }) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
