import { type ReactNode } from 'react';
import { Icon } from './Icon';
import styles from '@/styles/shared/components/ui/CardHead.module.css';

interface CardHeadProps {
  title: string;
  sub?: string;
  icon?: string;
  action?: ReactNode;
}

export function CardHead({ title, sub, icon, action }: CardHeadProps) {
  return (
    <div className={styles.head}>
      <div className={styles.left}>
        {icon && (
          <span className={styles.icon}>
            <Icon name={icon} size={16} />
          </span>
        )}
        <div>
          <div className={styles.title}>{title}</div>
          {sub && <div className={styles.sub}>{sub}</div>}
        </div>
      </div>
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
