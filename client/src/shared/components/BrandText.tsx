import { BRAND_NAME, BRAND_TAGLINE } from '@/shared/brand';
import styles from '@/styles/shared/components/BrandText.module.css';

interface BrandTextProps {
  className?: string;
}

export function BrandText({ className = '' }: BrandTextProps) {
  return (
    <span className={`${styles.root} ${className}`} aria-label={`${BRAND_NAME} — ${BRAND_TAGLINE}`}>
      <span className={styles.wordmark} aria-hidden="true">
        {BRAND_NAME.toUpperCase()}
      </span>
      <span className={styles.tagline} aria-hidden="true">
        {BRAND_TAGLINE.toUpperCase()}
      </span>
    </span>
  );
}
