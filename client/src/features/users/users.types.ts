import { Role, UserStatus } from '@/shared/types/enums';
export { Role, UserStatus };

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  roleId: string | null;
  roleName: string | null;
  status: UserStatus;
  /** Null = has never completed a real login (invited/imported but not yet activated). */
  lastLoginAt: string | null;
  createdAt: string;
  avatarUrl?: string;
  mailboxId?: string | null;
  /** True while the user holds at least one live (non-expired) login session. */
  isOnline: boolean;
}
