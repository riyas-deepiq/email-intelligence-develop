import { useAuth } from '@/features/auth/useAuth';
import { Role } from '@/shared/types/enums';
import { AdminOverviewView } from './AdminOverviewView';
import { UserOverviewView }  from './UserOverviewView';

// Routes to admin or user dashboard based on the current user's role.
export function OverviewView() {
  const { user } = useAuth();
  const isAdmin = user?.role === Role.Admin || user?.role === Role.SuperAdmin;
  return isAdmin ? <AdminOverviewView /> : <UserOverviewView />;
}
