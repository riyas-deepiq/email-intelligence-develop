import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { attachments, mailboxes, messages } from '../../db/schema';
import { asyncHandler } from '../../lib/async-handler';
import { config } from '../../config/env';
import { AttachmentDownloadError, downloadAttachment } from '../../services/attachments.service';

// Internal channel for the Python RAG service to fetch attachment bytes for
// vectorization. `attachments` in Postgres is metadata only (see schema.ts) —
// bytes are always live-fetched from the mail provider, same as the
// user-facing GET /messages/:id/attachments/:attachmentId route, just
// reachable without a user session. Guarded by RAG_API_SECRET, the shared
// secret already used for the Server -> RAG query channel (see RAG's
// api/internal_auth.py); reused here for the reverse direction between the
// same two trusted services instead of minting a new one.

export const ragInternalRouter = Router();

ragInternalRouter.use((req, res, next) => {
  if (!config.ragApi.secret) {
    res
      .status(503)
      .json({ error: { code: 'not_configured', message: 'RAG_API_SECRET is not set' } });
    return;
  }
  const auth = req.headers['authorization'];
  if (auth !== `Bearer ${config.ragApi.secret}`) {
    res
      .status(401)
      .json({ error: { code: 'unauthorized', message: 'Invalid or missing internal secret' } });
    return;
  }
  next();
});

/**
 * GET /v1/rag-internal/attachments/:id/content
 * Fetch one attachment's bytes (base64) + name/content-type, by its Postgres
 * `attachments.id`. Used by the RAG ingestion pipeline to vectorize
 * attachment content into Qdrant (RAG/ingestion/attachment_downloader.py).
 */
ragInternalRouter.get(
  '/attachments/:id/content',
  asyncHandler(async (req, res) => {
    const db = getDb();

    const [row] = await db
      .select({
        providerMessageId: messages.providerMessageId,
        providerAttachmentId: attachments.providerAttachmentId,
        name: attachments.name,
        mailboxAddress: mailboxes.address,
        mailboxProvider: mailboxes.provider,
        providerUserId: mailboxes.providerUserId,
      })
      .from(attachments)
      .innerJoin(messages, eq(attachments.messageId, messages.id))
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(eq(attachments.id, req.params['id']!));

    if (!row) {
      res.status(404).json({ error: { code: 'not_found', message: 'Attachment not found' } });
      return;
    }

    try {
      const file = await downloadAttachment(
        {
          address: row.mailboxAddress,
          provider: row.mailboxProvider,
          providerUserId: row.providerUserId,
        },
        row.providerMessageId,
        row.providerAttachmentId,
      );
      res.status(200).json({
        data: {
          name: file.name || row.name,
          contentType: file.contentType,
          base64: file.data.toString('base64'),
        },
      });
    } catch (err) {
      const failure = err instanceof AttachmentDownloadError ? err : null;
      const retryable = failure?.retryable ?? true;
      res.status(retryable ? 502 : 422).json({
        error: {
          code: retryable ? 'attachment_fetch_failed' : 'attachment_unavailable',
          message: failure?.message ?? 'Could not download the attachment from the mail provider.',
          retryable,
          providerStatus: failure?.providerStatus,
        },
      });
    }
  }),
);
