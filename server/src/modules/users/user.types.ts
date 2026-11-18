export type UserRole = 'employee' | 'admin' | 'superadmin';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  roleId: string | null;
  roleName: string | null;
  status: string;
  /** Null = has never completed a real login (invited/imported but not yet activated). */
  lastLoginAt: string | null;
  createdAt: string;
  mailboxId?: string | null;
}

export interface CreateUserInput {
  email: string;
  displayName: string;
  role?: UserRole;
  roleId?: string | null;
  status?: string;
}
