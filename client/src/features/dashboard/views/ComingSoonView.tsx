import styles from '@/styles/features/dashboard/pages/Dashboard.module.css';

interface ComingSoonViewProps {
  title: string;
  phase: string;
  description: string;
  bullets: string[];
}

export function ComingSoonView({ title, phase, description, bullets }: ComingSoonViewProps) {
  return (
    <div className={styles.comingSoonWrap}>
      <div className={styles.comingSoonCard}>
        <span className={styles.csPhase}>{phase}</span>
        <h1 className={styles.csTitle}>{title}</h1>
        <p className={styles.csDesc}>{description}</p>
        <ul className={styles.csList}>
          {bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
      </div>
    </div>
  );
}
