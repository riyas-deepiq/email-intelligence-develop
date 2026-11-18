import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMailboxPhoto } from './mailboxes.api';

interface Props {
  mailboxId: string;
  /** Used for the initials fallback and the img alt text. */
  name: string;
  fallbackBg?: string;
  size?: number;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Renders a mailbox's profile photo, lazily fetched (and cached) via an
 * authenticated request so the heavy Base64 images stay out of the mailbox list
 * payload. Falls back to initials on a coloured circle when there is no photo.
 */
export function MailboxAvatar({ mailboxId, name, fallbackBg = '#64748b', size = 32 }: Props) {
  const { data: photo } = useQuery({
    queryKey: ['mailbox-photo', mailboxId],
    queryFn:  () => getMailboxPhoto(mailboxId),
    staleTime: 5 * 60 * 1000,
  });
  const [broken, setBroken] = useState(false);

  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
  } as const;

  if (photo && !broken) {
    return <img src={photo} alt={name} style={{ ...base, objectFit: 'cover' }} onError={() => setBroken(true)} />;
  }

  return (
    <span
      style={{
        ...base,
        background: fallbackBg,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.4,
        fontWeight: 600,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}
