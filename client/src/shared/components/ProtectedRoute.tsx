import { Navigate } from 'react-router-dom';
import { useAuth } from '@/features/auth/useAuth';
import styles from '@/styles/shared/components/ProtectedRoute.module.css';

interface Props {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: Props) {
  const { user, loading, requiresSetup } = useAuth();

  if (loading) {
    return (
      <div className={styles.spinnerWrap}>
        <span className={styles.spinner} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}
