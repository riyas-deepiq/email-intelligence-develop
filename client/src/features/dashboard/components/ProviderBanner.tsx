import { useNavigate } from 'react-router-dom';
import IcInfo from '@/assets/icons/info.svg?react';
import { View, viewPath } from '../dashboard.types';
import styles from '@/styles/features/dashboard/components/ProviderBanner.module.css';

export function ProviderBanner() {
  const navigate = useNavigate();

  return (
    <div className={styles.banner}>
      <div className={styles.bannerIcon}>
        <IcInfo width={16} height={16} />
      </div>
      <div className={styles.bannerText}>
        <strong>No email provider connected.</strong>{' '}
        The platform won't index any emails until you connect Microsoft 365 or Google Workspace.
      </div>
      <button
        className={styles.bannerBtn}
        onClick={() => navigate(viewPath(View.EmailProvider))}
      >
        Connect Provider →
      </button>
    </div>
  );
}
