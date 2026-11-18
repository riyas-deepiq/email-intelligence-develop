import { randomUUID } from 'node:crypto';
import { config } from '../../config/env';
import { PgChatRepository } from './chat.repository.pg';
import type {
  AppendMessageInput,
  ChatMessageEntry,
  ChatSessionEntry,
  CreateSessionInput,
} from './chat.types';

export interface ChatRepository {
  createSession(input: CreateSessionInput): Promise<ChatSessionEntry>;
  listSessions(userId: string, limit?: number): Promise<ChatSessionEntry[]>;
  getSession(id: string, userId: string): Promise<ChatSessionEntry | null>;
  getMessages(sessionId: string): Promise<ChatMessageEntry[]>;
  appendMessage(input: AppendMessageInput): Promise<ChatMessageEntry>;
  /** Returns false when the session doesn't exist or isn't owned by userId. */
  deleteSession(id: string, userId: string): Promise<boolean>;
}

interface StoredSession extends ChatSessionEntry {
  userId: string;
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly sessions = new Map<string, StoredSession>();
  private readonly messages = new Map<string, ChatMessageEntry[]>();

  async createSession(input: CreateSessionInput): Promise<ChatSessionEntry> {
    const now = new Date().toISOString();
    const entry: StoredSession = {
      id: randomUUID(),
      userId: input.userId,
      title: input.title,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(entry.id, entry);
    this.messages.set(entry.id, []);
    return this.toPublic(entry);
  }

  async listSessions(userId: string, limit = 50): Promise<ChatSessionEntry[]> {
    return Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((s) => this.toPublic(s));
  }

  async getSession(id: string, userId: string): Promise<ChatSessionEntry | null> {
    const s = this.sessions.get(id);
    if (!s || s.userId !== userId) return null;
    return this.toPublic(s);
  }

  async getMessages(sessionId: string): Promise<ChatMessageEntry[]> {
    return this.messages.get(sessionId) ?? [];
  }

  async appendMessage(input: AppendMessageInput): Promise<ChatMessageEntry> {
    const entry: ChatMessageEntry = {
      id: randomUUID(),
      role: input.role,
      content: input.content,
      citations: input.citations ?? [],
      grounding: input.grounding ?? null,
      createdAt: new Date().toISOString(),
    };
    const list = this.messages.get(input.sessionId) ?? [];
    list.push(entry);
    this.messages.set(input.sessionId, list);

    const session = this.sessions.get(input.sessionId);
    if (session) {
      session.messageCount += 1;
      session.updatedAt = entry.createdAt;
      session.lastMessage = input.content.slice(0, 140);
      // First user question becomes the session title.
      if (!session.title && input.role === 'user') session.title = input.content.slice(0, 80);
    }
    return entry;
  }

  async deleteSession(id: string, userId: string): Promise<boolean> {
    const s = this.sessions.get(id);
    // Ownership is checked here, not in the caller — a session that isn't
    // yours must be indistinguishable from one that doesn't exist.
    if (!s || s.userId !== userId) return false;
    this.sessions.delete(id);
    this.messages.delete(id);
    return true;
  }

  private toPublic(s: StoredSession): ChatSessionEntry {
    return {
      id: s.id,
      title: s.title,
      lastMessage: s.lastMessage,
      messageCount: s.messageCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    };
  }
}

export function createChatRepository(): ChatRepository {
  if (config.env === 'test' || config.database.driver === 'memory') {
    return new InMemoryChatRepository();
  }
  return new PgChatRepository();
}
