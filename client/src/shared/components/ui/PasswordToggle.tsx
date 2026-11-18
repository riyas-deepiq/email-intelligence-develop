import IcEye from '@/assets/icons/eye.svg?react';
import IcEyeOff from '@/assets/icons/eye-off.svg?react';
import styles from '@/styles/shared/components/ui/PasswordToggle.module.css';

export interface PasswordToggleProps {
  visible: boolean;
  onToggle: () => void;
  className?: string;
}

export function PasswordToggle({ visible, onToggle, className }: PasswordToggleProps) {
  return (
    <button
      type="button"
      className={`${styles.toggle} ${className ?? ''}`}
      onClick={onToggle}
      tabIndex={-1}
      aria-label={visible ? 'Hide password' : 'Show password'}
      aria-pressed={visible}
    >
      <span className={styles.iconStack}>
        <IcEye
          className={`${styles.icon} ${!visible ? styles.iconActive : styles.iconHidden}`}
          width={16}
          height={16}
        />
        <IcEyeOff
          className={`${styles.icon} ${visible ? styles.iconActive : styles.iconHidden}`}
          width={16}
          height={16}
        />
      </span>
    </button>
  );
}
