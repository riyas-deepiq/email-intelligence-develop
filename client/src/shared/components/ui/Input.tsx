import { useState, forwardRef } from 'react';
import type { ReactNode, InputHTMLAttributes } from 'react';
import { PasswordToggle } from './PasswordToggle';
import styles from '@/styles/shared/components/ui/Input.module.css';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string;
  prefixIcon?: ReactNode;
  suffixIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  label,
  hint,
  error,
  prefixIcon,
  suffixIcon,
  type = 'text',
  id,
  className,
  ...props
}, ref) => {
  const [showPw, setShowPw] = useState(false);
  const isPassword = type === 'password';
  const resolvedType = isPassword ? (showPw ? 'text' : 'password') : type;

  const fieldId = id ?? (
    typeof label === 'string'
      ? `input-${label.toLowerCase().replace(/\s+/g, '-')}`
      : undefined
  );

  return (
    <div className={`${styles.field} ${error ? styles.hasError : ''}`}>
      {label && (
        <label htmlFor={fieldId} className={styles.label}>{label}</label>
      )}
      <div className={styles.inputWrap}>
        {prefixIcon && (
          <span className={styles.prefixIcon}>{prefixIcon}</span>
        )}
        <input
          ref={ref}
          id={fieldId}
          type={resolvedType}
          className={[
            styles.input,
            prefixIcon     ? styles.hasPrefixIcon : '',
            suffixIcon || isPassword ? styles.hasSuffixIcon : '',
            className ?? '',
          ].filter(Boolean).join(' ')}
          {...props}
        />
        {isPassword && (
          <PasswordToggle
            className={styles.suffixBtn}
            visible={showPw}
            onToggle={() => setShowPw(v => !v)}
          />
        )}
        {!isPassword && suffixIcon && (
          <span className={styles.suffixIcon}>{suffixIcon}</span>
        )}
      </div>
      {error  && <span className={styles.errorMsg}>{error}</span>}
      {!error && hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
});

Input.displayName = 'Input';
