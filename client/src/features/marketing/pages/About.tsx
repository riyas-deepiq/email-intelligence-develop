import logoUrl from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME, BRAND_TAGLINE } from '@/shared/brand';
import styles from '@/styles/features/marketing/pages/About.module.css';

export function About() {
  return (
    <div className={styles.container}>
      <div className={styles.brandHero}>
        <img src={logoUrl} alt={`${BRAND_NAME} — ${BRAND_TAGLINE}`} className={styles.logo} />
        <div>
          <h1>{BRAND_NAME} Business Intelligence Platform</h1>
        </div>
      </div>
      <div className={styles.content}>
        <p>
          {BRAND_NAME} connects business systems to one private, permission-aware AI knowledge layer.
          Email and attachments are the first supported source, with accounting, documents,
          inventory, CRM, and MCP-connected tools planned as additional modules.
        </p>
      </div>
    </div>
  );
}
