export type MailProvider = 'm365' | 'google';

export interface EmailAddress {
  email: string;
  name?: string;
}

/** A mailbox the collector is asked to sync. */
export interface MailboxRef {
  id: string;
  orgId: string;
  address: string;
  provider: MailProvider;
  providerUserId?: string;
  syncToken?: string;
  syncFromDate?: string | null;
  /** How far back this mailbox has already been backfilled (the gap-fill upper bound). */
  backfilledFromAt?: string | null;
}

/** A normalized message returned by a connector (provider-agnostic). */
export interface RawMessage {
  providerMessageId: string; // Graph messageId / Gmail id
  providerThreadId?: string; // Graph conversationId / Gmail threadId
  rfcMessageId?: string; // Message-ID header
  subject?: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: EmailAddress[];
  ccAddresses: EmailAddress[];
  bccAddresses: EmailAddress[];
  bodyText?: string;
  hasAttachments: boolean;
  receivedAt: string; // ISO 8601
  sentAt?: string;
  sizeBytes?: number;
  importance?: 'low' | 'normal' | 'high';
  isRead?: boolean;
  labels?: string[];
}

/**
 * Terminal summary of a streamed fetch — produced once the message stream is
 * fully drained. The sync cursor deliberately arrives only at the END of the
 * stream: it must never be persisted unless the fetch ran to completion.
 */
export interface FetchSummary {
  /** New delta/history token to persist for the next incremental run. */
  nextSyncToken?: string;
}

/**
 * A mailbox fetch as a stream of message pages (one provider page ≈ 50–100
 * messages), ending with the FetchSummary. Streaming — instead of returning
 * one giant array — is what keeps collector memory flat: a 300k-message
 * mailbox and a 600-message mailbox both hold at most one page + one flush
 * buffer in RAM at any moment.
 */
export type MessageStream = AsyncGenerator<RawMessage[], FetchSummary, void>;

/** A sub-stream of pages with no terminal summary (composed via yield*). */
export type MessagePageStream = AsyncGenerator<RawMessage[], void, void>;

/** Result of a probe run for one mailbox. */
export interface ProbeResult {
  earliestEmailAt?: string; // ISO 8601 of oldest message
  emailCountEstimate?: number;
}
