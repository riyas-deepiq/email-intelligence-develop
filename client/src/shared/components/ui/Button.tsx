import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from '@/styles/shared/components/ui/Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:    Variant;
  size?:       Size;
  loading?:    boolean;
  fullWidth?:  boolean;
  prefixIcon?: ReactNode;
  suffixIcon?: ReactNode;
}

function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

export function Button({
  variant   = 'primary',
  size      = 'md',
  loading   = false,
  fullWidth = false,
  prefixIcon,
  suffixIcon,
  children,
  disabled,
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        styles.btn,
        styles[variant],
        styles[size],
        fullWidth ? styles.fullWidth : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      {...props}
    >
      {loading
        ? <Spinner />
        : prefixIcon && <span className={styles.icon}>{prefixIcon}</span>
      }
      {children}
      {!loading && suffixIcon && (
        <span className={styles.icon}>{suffixIcon}</span>
      )}
    </button>
  );
}
