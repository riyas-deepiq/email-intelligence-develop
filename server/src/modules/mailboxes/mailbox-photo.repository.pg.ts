import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { mailboxes } from '../../db/schema';
import type { MailboxPhoto, MailboxPhotoRepository } from './mailbox-photo.repository';

export class PgMailboxPhotoRepository implements MailboxPhotoRepository {
  async upsert(mailboxId: string, contentType: string, data: string): Promise<void> {
    await getDb()
      .update(mailboxes)
      .set({ photoContentType: contentType, photoData: data, updatedAt: new Date() })
      .where(eq(mailboxes.id, mailboxId));
  }

  async findByMailboxId(mailboxId: string): Promise<MailboxPhoto | null> {
    const [row] = await getDb()
      .select({
        photoData: mailboxes.photoData,
        photoContentType: mailboxes.photoContentType,
        updatedAt: mailboxes.updatedAt,
      })
      .from(mailboxes)
      .where(eq(mailboxes.id, mailboxId));

    if (!row || !row.photoData) return null;
    return {
      mailboxId,
      contentType: row.photoContentType ?? 'image/jpeg',
      data: row.photoData,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async deleteByMailboxId(mailboxId: string): Promise<void> {
    await getDb()
      .update(mailboxes)
      .set({ photoData: null, updatedAt: new Date() })
      .where(eq(mailboxes.id, mailboxId));
  }
}
