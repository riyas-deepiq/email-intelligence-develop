import { Icon } from './Icon';
import styles from '@/styles/shared/components/ui/StatCard.module.css';

const TONE_CLASS: Record<string, string> = {
  accent: styles.accent,
  teal:   styles.teal,
  violet: styles.violet,
  warn:   styles.warn,
  ok:     styles.ok,
  danger: styles.danger,
};

interface StatCardData {
  lab: string;
  val: string | number;
  delta?: string;
  dir?: 'up' | 'down' | 'flat';
  icon?: string;
  tone?: string;
  /** Explicit icon colour (e.g. a palette-ramp shade). Overrides `tone` so the
   *  icon badge follows the active colour palette instead of a fixed tone. */
  color?: string;
}

interface StatCardProps {
  d: StatCardData;
}

export function StatCard({ d }: StatCardProps) {
  const toneClass = TONE_CLASS[d.tone ?? 'accent'] ?? styles.accent;
  // When a palette colour is supplied, render the bold badge — a solid single-hue
  // gradient with a white glyph and a soft coloured glow, matching the dashboard
  // overview cards. Otherwise fall back to the tone class's soft tint.
  const iconStyle = d.color
    ? {
        background: `linear-gradient(135deg, ${d.color}, color-mix(in srgb, ${d.color} 62%, #ffffff))`,
        boxShadow: `0 6px 16px -4px ${d.color}66`,
        color: '#ffffff',
      }
    : undefined;
  return (
    <div className={`${styles.card} ${toneClass}`}>
      {d.icon && (
        <div className={styles.iconWrap} style={iconStyle}>
          <Icon name={d.icon} size={18} />
        </div>
      )}
      <div className={styles.lab}>{d.lab}</div>
      <div className={styles.val}>{d.val}</div>
      {d.delta && (
        <div className={`${styles.delta} ${d.dir === 'up' ? styles.up : d.dir === 'down' ? styles.down : styles.flat}`}>
          {d.dir === 'up' && <Icon name="arrowUp" size={11} />}
          {d.dir === 'down' && <Icon name="arrowDown" size={11} />}
          {d.delta}
        </div>
      )}
    </div>
  );
}
