import type { ReactNode, SelectHTMLAttributes } from 'react';
import IcChevronDown from '@/assets/icons/chevron-down.svg?react';
import styles from '@/styles/shared/components/ui/Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?:       ReactNode;
  hint?:        ReactNode;
  error?:       string;
  options:      SelectOption[];
  placeholder?: string;
}

export function Select({
  label,
  hint,
  error,
  options,
  placeholder,
  id,
  className,
  ...props
}: SelectProps) {
  const fieldId = id ?? (
    typeof label === 'string'
      ? `select-${label.toLowerCase().replace(/\s+/g, '-')}`
      : undefined
  );

  return (
    <div className={`${styles.field} ${error ? styles.hasError : ''}`}>
      {label && (
        <label htmlFor={fieldId} className={styles.label}>{label}</label>
      )}
      <div className={styles.selectWrap}>
        <select
          id={fieldId}
          className={[styles.select, className ?? ''].filter(Boolean).join(' ')}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>{placeholder}</option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className={styles.arrow}><IcChevronDown width={14} height={14} /></span>
      </div>
      {error  && <span className={styles.errorMsg}>{error}</span>}
      {!error && hint && <span className={styles.hint}>{hint}</span>}
    </div>
  );
}
