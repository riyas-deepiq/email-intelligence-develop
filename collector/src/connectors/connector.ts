import type { MailboxRef, MessageStream, ProbeResult } from './connector.types';

export interface MailConnector {
  readonly provider: string;
  /**
   * Fetch new messages since the mailbox's sync token (backfill on first run)
   * as a stream of pages. The caller drains pages into its flush buffer as
   * they arrive; the stream's return value carries the next sync cursor.
   */
  fetchMailbox(mailbox: MailboxRef): MessageStream;
  /**
   * Gap-fill: fetch messages in [from, to) only — used when a mailbox's target
   * sync depth has widened past what's already been backfilled. Never advances
   * or returns a sync token; the forward/incremental cursor is untouched.
   */
  fetchBackfillRange(mailbox: MailboxRef, from: string, to: string): MessageStream;
  /** Determine the oldest email date and rough message count for a mailbox. */
  probeMailbox(mailbox: MailboxRef): Promise<ProbeResult>;
}
