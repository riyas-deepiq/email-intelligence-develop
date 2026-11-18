import type { ReactNode } from 'react';
import { MailboxAvatar } from '@/features/mailboxes/MailboxAvatar';
import { Avatar } from './Avatar';
import styles from '@/styles/shared/components/ui/UserCell.module.css';

interface UserCellProps {
  /** Primary line — display name (or email when no name is known). */
  name: string;
  /** Muted second line — email, role, "title · email", etc. Omit for a single-line cell. */
  secondary?: ReactNode;
  /** When set, the avatar shows the mailbox's directory photo (initials fallback). */
  mailboxId?: string;
  /** Avatar diameter in px. */
  size?: number;
  /** Avatar background when there is no photo; defaults to a name-hashed color. */
  fallbackBg?: string;
}

/**
 * The app-wide "user identity" cell: avatar + name + muted secondary line.
 * Used in every table/list that shows a person or mailbox, so layout or style
 * changes here propagate everywhere.
 */
export function UserCell({ name, secondary, mailboxId, size = 28, fallbackBg }: UserCellProps) {
  return (
    <div className={styles.cell}>
      {mailboxId ? (
        <MailboxAvatar
          mailboxId={mailboxId}
          name={name}
          size={size}
          fallbackBg={fallbackBg ?? '#64748b'}
        />
      ) : (
        <Avatar name={name} size={size} color={fallbackBg} />
      )}
      <div className={styles.text}>
        <div className={styles.name}>{name}</div>
        {secondary != null && secondary !== '' && (
          <div className={styles.secondary}>{secondary}</div>
        )}
      </div>
    </div>
  );
}
