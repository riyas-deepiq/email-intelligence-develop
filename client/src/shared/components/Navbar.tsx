import { Link } from 'react-router-dom';
import logoUrl from '@/assets/icons/insight-hub-icon.png';
import { BRAND_NAME } from '@/shared/brand';
import { BrandText } from './BrandText';
import styles from '@/styles/shared/components/Navbar.module.css';

export function Navbar() {
  return (
    <nav className={styles.navbar}>
      <div className={styles.container}>
        <Link to="/" className={styles.logo}>
          <span className={styles.logoIconWrap}>
            <img src={logoUrl} alt={`${BRAND_NAME} logo`} className={styles.logoIcon} />
          </span>
          <BrandText className={styles.logoCopy} />
        </Link>
        <ul className={styles.menu}>
          <li><Link to="/about" className={styles.link}>About</Link></li>
          <li><Link to="/contact" className={styles.link}>Contact</Link></li>
          <li><Link to="/login" className={styles.link}>Login</Link></li>
        </ul>
      </div>
    </nav>
  );
}
