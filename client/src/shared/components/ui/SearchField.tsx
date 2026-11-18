import { Icon } from './Icon';
import styles from '@/styles/shared/components/ui/SearchField.module.css';

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Custom clear-button handler. Defaults to `onChange('')`. Views with a
   *  debounced query pass one that resets both the immediate and debounced
   *  state so results clear instantly rather than after the debounce. */
  onClear?: () => void;
  /** Defaults to "Search…". */
  placeholder?: string;
  /** Extra class appended to the pill wrapper (e.g. to tweak width in a tight header). */
  className?: string;
  autoFocus?: boolean;
  'aria-label'?: string;
}

/**
 * The single search-bar pill used across every table view (Users, Mail,
 * Threads, Attachments, and — via TableToolbar — Mailboxes/Audit). A bordered
 * near-white fill keeps it visible against the cream canvas in light mode, with
 * a hover border and a brand focus ring. All search fields render through this
 * one component so their look and behaviour stay identical.
 */
export function SearchField({
  value,
  onChange,
  onClear,
  placeholder = 'Search…',
  className,
  autoFocus,
  'aria-label': ariaLabel,
}: SearchFieldProps) {
  return (
    <div className={`${styles.field}${className ? ` ${className}` : ''}`}>
      <Icon name="search" size={14} className={styles.icon} />
      <input
        type="text"
        className={styles.input}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        aria-label={ariaLabel ?? placeholder}
      />
      {value && (
        <button
          type="button"
          className={styles.clear}
          onClick={() => (onClear ? onClear() : onChange(''))}
          aria-label="Clear search"
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </div>
  );
}
