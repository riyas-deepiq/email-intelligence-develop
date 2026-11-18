import { eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { mailboxes, searchQueries } from '../../db/schema';
import { logger } from '../../lib/logger';
import { getScopedMailboxIds } from '../../lib/mailbox-scope';
import { askRag, streamRag, type RagAskResponse, type RagSourceChunk } from './clients/rag.client';
import type { ChatRepository } from './chat.repository';
import type { ChatMessageEntry, ChatSessionEntry, Citation, Grounding } from './chat.types';

export interface AuthedUser {
  id: string;
  role: string;
}

export interface SearchAnalyticsInput {
  orgId: string;
  userId: string;
  question: string;
  responseMs: number;
  success: boolean;
  intent?: string | null;
}

const INTENT_RULES: Array<{ intent: string; pattern: RegExp }> = [
  { intent: 'summary', pattern: /\b(summary|summarize|summarise|recap|brief|overview|digest)\b/i },
  {
    intent: 'attachments',
    pattern: /\b(attachment|attachments|file|files|document|documents|pdf|invoice|receipt)\b/i,
  },
  {
    intent: 'schedule',
    pattern: /\b(schedule|meeting|calendar|deadline|appointment|availability|when)\b/i,
  },
  {
    intent: 'policy',
    pattern: /\b(policy|policies|compliance|hr|leave|pto|vacation|benefit|benefits)\b/i,
  },
  {
    intent: 'finance',
    pattern: /\b(budget|finance|financial|payment|cost|price|pricing|expense|contract|proposal)\b/i,
  },
  {
    intent: 'people',
    pattern: /\b(who|from|sender|recipient|team|manager|ceo|client|customer|vendor)\b/i,
  },
  {
    intent: 'thread_lookup',
    pattern: /\b(thread|conversation|reply|replies|follow\s?up|followup)\b/i,
  },
  {
    intent: 'email_search',
    pattern: /\b(find|search|show|list|emails?|mail|mails|about|regarding)\b/i,
  },
];

export function inferSearchIntent(question: string): string {
  for (const rule of INTENT_RULES) {
    if (rule.pattern.test(question)) return rule.intent;
  }
  return 'general';
}

const ATTACHABLE_SOURCE_PATTERN =
  /\b(e-?mails|mails?|messages?|threads?|conversations?|documents?|docs?|files?|attachments?|pdfs?|invoices?|receipts?|sources?|citations?)\b|\b(?:the|that|this|an|a|one)\s+e-?mail\b|\be-?mail\s+(?:from|sent|about|regarding|with)\b/i;

const SOURCE_REQUEST_PATTERN =
  /\b(find|search|show|list|open|view|get|attach|include|send|link|cite|reference|which|what|where|who)\b/i;

export function shouldAttachSearchSources(question: string): boolean {
  return ATTACHABLE_SOURCE_PATTERN.test(question) && SOURCE_REQUEST_PATTERN.test(question);
}

export class ChatService {
  constructor(private readonly repo: ChatRepository) {}

  /**
   * A user's real, authenticated mailbox access scope - the exact same
   * primitive the messages/attachments routes already use (own mailbox +
   * org-hierarchy reports, or every mailbox in THIS ORG for superadmin).
   * RAG never re-derives identity itself; it trusts this list directly.
   *
   * Only superadmin (the single reserved owner-level account, see
   * role.service.ts SYSTEM_ROLES) gets the full-org bypass. 'admin' falls
   * through to getScopedMailboxIds() below, same as everyone else, so two
   * admin-tier peers with no reporting relationship can't see each other's
   * mailbox via chat either.
   *
   * The superadmin branch is scoped by orgId deliberately: every other table
   * in the schema is org-scoped with cascade deletes, and an unfiltered
   * `select().from(mailboxes)` would hand them every mailbox of every org
   * the moment this is deployed as anything other than single-tenant. Scoping
   * here costs nothing today and closes that hole permanently.
   */
  async resolveMailboxScope(user: AuthedUser, orgId: string): Promise<string[]> {
    const isAdmin = user.role === 'superadmin';
    if (isAdmin) {
      const db = getDb();
      const all = await db
        .select({ id: mailboxes.id })
        .from(mailboxes)
        .where(eq(mailboxes.orgId, orgId));
      return all.map((m) => m.id);
    }
    return getScopedMailboxIds(user.id);
  }

  async listSessions(userId: string): Promise<ChatSessionEntry[]> {
    return this.repo.listSessions(userId);
  }

  async getSessionWithMessages(
    sessionId: string,
    userId: string,
  ): Promise<{ session: ChatSessionEntry; messages: ChatMessageEntry[] } | null> {
    const session = await this.repo.getSession(sessionId, userId);
    if (!session) return null;
    const messages = await this.repo.getMessages(sessionId);
    return { session, messages };
  }

  /** Deletes a conversation the caller owns. False when it isn't theirs or doesn't exist. */
  async deleteSession(sessionId: string, userId: string): Promise<boolean> {
    return this.repo.deleteSession(sessionId, userId);
  }

  /** Reuses sessionId if it's a real session owned by this user; otherwise starts a new one. */
  async ensureSession(
    sessionId: string | undefined,
    orgId: string,
    userId: string,
    question: string,
  ): Promise<string> {
    if (sessionId) {
      const existing = await this.repo.getSession(sessionId, userId);
      if (existing) return sessionId;
    }
    const created = await this.repo.createSession({ orgId, userId, title: question.slice(0, 80) });
    return created.id;
  }

  toCitations(chunks: RagSourceChunk[]): Citation[] {
    return chunks.map((c) => ({
      messageId: c.email_id,
      threadId: c.thread_id,
      subject: c.subject,
      from: c.from_addr,
      date: c.date,
      documentId: c.email_id,
      snippet: c.excerpt,
    }));
  }

  groundingFrom(citations: Citation[]): Grounding {
    return citations.length > 0 ? 'grounded' : 'not_found';
  }

  shouldAttachSearchSources(question: string): boolean {
    return shouldAttachSearchSources(question);
  }

  async recordTurn(
    sessionId: string,
    question: string,
    answer: string,
    citations: Citation[],
    grounding: Grounding,
  ): Promise<void> {
    await this.repo.appendMessage({ sessionId, role: 'user', content: question });
    await this.repo.appendMessage({
      sessionId,
      role: 'assistant',
      content: answer,
      citations,
      grounding,
    });
  }

  async recordSearchAnalytics(input: SearchAnalyticsInput): Promise<void> {
    const queryText = input.question.trim();
    if (!queryText) return;

    try {
      await getDb()
        .insert(searchQueries)
        .values({
          orgId: input.orgId,
          userId: input.userId,
          queryText,
          intent: input.intent ?? inferSearchIntent(queryText),
          responseMs: Number.isFinite(input.responseMs)
            ? Math.max(0, Math.round(input.responseMs))
            : 0,
          success: input.success,
        });
    } catch (err) {
      logger.warn({ err, userId: input.userId }, 'Failed to record search query analytics');
    }
  }

  async ask(question: string, mailboxIds: string[]): Promise<RagAskResponse> {
    return askRag(question, mailboxIds);
  }

  async stream(question: string, mailboxIds: string[], signal?: AbortSignal): Promise<Response> {
    return streamRag(question, mailboxIds, signal);
  }
}
