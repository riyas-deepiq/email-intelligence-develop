import styles from '@/styles/shared/components/ui/Avatar.module.css';

const COLORS = ['#4f46e5','#0078d4','#7c3aed','#6366f1','#d97706','#0891b2','#c55a11','#8b5cf6'];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}

interface AvatarProps {
  name: string;
  size?: number;
  color?: string;
}

export function Avatar({ name, size = 32, color }: AvatarProps) {
  const bg = color ?? hashColor(name);
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span
      className={styles.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.37), background: bg }}
      aria-label={name}
    >
      {initials}
    </span>
  );
}
