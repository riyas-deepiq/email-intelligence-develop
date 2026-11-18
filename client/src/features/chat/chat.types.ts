// ─── Chat Session & Message types ─────────────────────────────────────────

export interface Citation {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  documentId: string;
  snippet: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  grounding?: 'grounded' | 'not_found' | 'partial';
  createdAt: string;
  streaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  lastMessage?: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface QueryRequest {
  question: string;
  sessionId?: string;
}

export interface QueryResponse {
  answer: string;
  citations: Citation[];
  grounding: 'grounded' | 'not_found' | 'partial';
  sessionId: string;
}
