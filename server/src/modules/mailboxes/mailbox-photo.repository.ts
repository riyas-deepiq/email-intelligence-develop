import { config } from '../../config/env';
import { PgMailboxPhotoRepository } from './mailbox-photo.repository.pg';

export interface MailboxPhoto {
  mailboxId: string;
  contentType: string;
  data: string; // raw Base64 (no data: URI prefix)
  updatedAt: string;
}

export interface MailboxPhotoRepository {
  /** Insert or replace the photo for a mailbox. */
  upsert(mailboxId: string, contentType: string, data: string): Promise<void>;
  findByMailboxId(mailboxId: string): Promise<MailboxPhoto | null>;
  deleteByMailboxId(mailboxId: string): Promise<void>;
}

export class InMemoryMailboxPhotoRepository implements MailboxPhotoRepository {
  private readonly store = new Map<string, MailboxPhoto>();

  async upsert(mailboxId: string, contentType: string, data: string): Promise<void> {
    this.store.set(mailboxId, {
      mailboxId,
      contentType,
      data,
      updatedAt: new Date().toISOString(),
    });
  }

  async findByMailboxId(mailboxId: string): Promise<MailboxPhoto | null> {
    return this.store.get(mailboxId) ?? null;
  }

  async deleteByMailboxId(mailboxId: string): Promise<void> {
    this.store.delete(mailboxId);
  }
}

export function createMailboxPhotoRepository(): MailboxPhotoRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return new InMemoryMailboxPhotoRepository();
  }
  return new PgMailboxPhotoRepository();
}

/**
 * Splits a Base64 data URI ("data:image/jpeg;base64,AAAA…") into its content
 * type and raw Base64 payload. Returns null for anything that isn't a Base64
 * data URI so callers can skip storing it.
 */
export function parseDataUri(dataUri: string): { contentType: string; data: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUri.trim());
  if (!match) return null;
  return { contentType: match[1], data: match[2] };
}
