import { env } from '../config/env';
import type { RawMessage } from '../connectors/connector.types';

async function postBatch(body: {
  jobId: string;
  orgId: string;
  mailboxId: string;
  messages: RawMessage[];
  nextSyncToken?: string;
}): Promise<{ accepted: number; skipped: number }> {
  const res = await fetch(`${env.SERVER_URL}/v1/internal/ingest/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.COLLECTOR_SECRET}`,
    },
    body: JSON.stringify(body),
    // Generous — a batch can be tens of MB — but bounded, so a dead connection
    // fails the flush (and the job retries) instead of hanging the worker forever.
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ingest/batch ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: { accepted: number; skipped: number } };
  return json.data;
}

const FLUSH_MAX_SIZE_BYTES = env.FLUSH_MAX_SIZE_MB * 1024 * 1024;

export class MessageBuffer {
  private buffer: RawMessage[] = [];
  private bufferedBytes = 0;
  private oldestBufferedAt: number | null = null;
  private stats = { accepted: 0, skipped: 0, errors: 0 };

  constructor(
    private readonly jobId: string,
    private readonly orgId: string,
    private readonly mailboxId: string,
  ) {}

  /**
   * Buffers a message and flushes immediately once any trigger threshold is
   * hit (message count / accumulated size / oldest-buffered age) — so a
   * long-running fetch persists progress incrementally instead of holding
   * everything in memory until the very end (previously FLUSH_MAX_SIZE_MB and
   * FLUSH_MAX_AGE_MS were parsed from env but never actually used).
   */
  async add(msg: RawMessage): Promise<void> {
    this.buffer.push(msg);
    this.bufferedBytes += Buffer.byteLength(JSON.stringify(msg), 'utf8');
    if (this.oldestBufferedAt === null) this.oldestBufferedAt = Date.now();

    if (this.shouldFlush()) {
      await this.flushBuffered(undefined);
    }
  }

  private shouldFlush(): boolean {
    if (this.buffer.length >= env.FLUSH_MAX_MESSAGES) return true;
    if (this.bufferedBytes >= FLUSH_MAX_SIZE_BYTES) return true;
    if (
      this.oldestBufferedAt !== null &&
      Date.now() - this.oldestBufferedAt >= env.FLUSH_MAX_AGE_MS
    )
      return true;
    return false;
  }

  private async flushBuffered(nextSyncToken: string | undefined): Promise<void> {
    if (this.buffer.length === 0) return;

    const chunkSize = env.FLUSH_MAX_MESSAGES;
    const chunks: RawMessage[][] = [];
    for (let i = 0; i < this.buffer.length; i += chunkSize) {
      chunks.push(this.buffer.slice(i, i + chunkSize));
    }
    this.buffer = [];
    this.bufferedBytes = 0;
    this.oldestBufferedAt = null;

    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      try {
        const result = await postBatch({
          jobId: this.jobId,
          orgId: this.orgId,
          mailboxId: this.mailboxId,
          messages: chunks[i]!,
          nextSyncToken: isLast ? nextSyncToken : undefined,
        });
        this.stats.accepted += result.accepted;
        this.stats.skipped += result.skipped;
      } catch (err) {
        this.stats.errors++;
        throw err;
      }
    }
  }

  /** Final flush — call once after all messages have been added. */
  async flush(nextSyncToken?: string): Promise<void> {
    await this.flushBuffered(nextSyncToken);
  }

  getStats(): { accepted: number; skipped: number; errors: number } {
    return { ...this.stats };
  }
}
