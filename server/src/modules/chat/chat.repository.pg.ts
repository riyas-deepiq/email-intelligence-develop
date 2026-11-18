import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { chatMessages, chatSessions } from '../../db/schema';
import type { ChatRepository } from './chat.repository';
import type {
  AppendMessageInput,
  ChatMessageEntry,
  ChatRole,
  ChatSessionEntry,
  Citation,
  CreateSessionInput,
  Grounding,
} from './chat.types';

type SessionRow = typeof chatSessions.$inferSelect;
type MessageRow = typeof chatMessages.$inferSelect;

function toSessionEntry(row: SessionRow, lastMessage?: string): ChatSessionEntry {
  return {
    id: row.id,
    title: row.title,
    lastMessage,
    messageCount: row.messageCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessageEntry(row: MessageRow): ChatMessageEntry {
  return {
    id: row.id,
    role: row.role as ChatRole,
    content: row.content,
    citations: (row.citations ?? []) as Citation[],
    grounding: (row.grounding ?? null) as Grounding | null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PgChatRepository implements ChatRepository {
  async createSession(input: CreateSessionInput): Promise<ChatSessionEntry> {
    const db = getDb();
    const [row] = await db
      .insert(chatSessions)
      .values({
        orgId: input.orgId,
        userId: input.userId,
        title: input.title,
      })
      .returning();
    return toSessionEntry(row!);
  }

  async listSessions(userId: string, limit = 50): Promise<ChatSessionEntry[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.updatedAt))
      .limit(limit);

    return Promise.all(
      rows.map(async (row) => {
        const [last] = await db
          .select({ content: chatMessages.content })
          .from(chatMessages)
          .where(eq(chatMessages.sessionId, row.id))
          .orderBy(desc(chatMessages.createdAt))
          .limit(1);
        return toSessionEntry(row, last?.content.slice(0, 140));
      }),
    );
  }

  async getSession(id: string, userId: string): Promise<ChatSessionEntry | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)));
    return row ? toSessionEntry(row) : null;
  }

  async deleteSession(id: string, userId: string): Promise<boolean> {
    const db = getDb();
    // userId is part of the WHERE rather than a separate ownership lookup, so
    // another user's session can never be deleted even by guessing its id.
    // chat_messages.session_id is ON DELETE CASCADE, so the turns go with it.
    const deleted = await db
      .delete(chatSessions)
      .where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId)))
      .returning({ id: chatSessions.id });
    return deleted.length > 0;
  }

  async getMessages(sessionId: string): Promise<ChatMessageEntry[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(chatMessages.createdAt);
    return rows.map(toMessageEntry);
  }

  async appendMessage(input: AppendMessageInput): Promise<ChatMessageEntry> {
    const db = getDb();
    const [row] = await db
      .insert(chatMessages)
      .values({
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        citations: input.citations ?? [],
        grounding: input.grounding ?? null,
      })
      .returning();

    // First user question becomes the session title (only if still blank).
    if (input.role === 'user') {
      await db
        .update(chatSessions)
        .set({
          messageCount: sql`${chatSessions.messageCount} + 1`,
          updatedAt: new Date(),
          title: sql`CASE WHEN ${chatSessions.title} = '' THEN ${input.content.slice(0, 80)} ELSE ${chatSessions.title} END`,
        })
        .where(eq(chatSessions.id, input.sessionId));
    } else {
      await db
        .update(chatSessions)
        .set({ messageCount: sql`${chatSessions.messageCount} + 1`, updatedAt: new Date() })
        .where(eq(chatSessions.id, input.sessionId));
    }

    return toMessageEntry(row!);
  }
}
