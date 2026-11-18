export type ChatRole = 'user' | 'assistant';
export type Grounding = 'grounded' | 'not_found' | 'partial';

/** Matches the client's Citation type exactly (client/src/features/chat/chat.types.ts). */
export interface Citation {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  documentId: string;
  snippet: string;
}

/** Matches the client's ChatMessage type (minus the client-only `streaming` flag). */
export interface ChatMessageEntry {
  id: string;
  role: ChatRole;
  content: string;
  citations: Citation[];
  grounding: Grounding | null;
  createdAt: string;
}

/** Matches the client's ChatSession type exactly. */
export interface ChatSessionEntry {
  id: string;
  title: string;
  lastMessage?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionInput {
  orgId: string;
  userId: string;
  title: string;
}

export interface AppendMessageInput {
  sessionId: string;
  role: ChatRole;
  content: string;
  citations?: Citation[];
  grounding?: Grounding | null;
}
