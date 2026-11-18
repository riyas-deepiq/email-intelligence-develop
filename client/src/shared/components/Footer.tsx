import { BrandText } from './BrandText';
import styles from '@/styles/shared/components/Footer.module.css';

export function Footer() {
  return (
    <footer className={styles.footer}>
      <BrandText className={styles.brandLockup} />
      <p className={styles.copy}>© {new Date().getFullYear()} Intelligence Labs Inc.</p>
    </footer>
  );
}
