import axios from 'axios';
import { apiClient, getToken, setToken } from '@/shared/api/client';
import type { ChatSession, QueryRequest, QueryResponse } from './chat.types';

const BASE_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

export async function postQuery(req: QueryRequest): Promise<QueryResponse> {
  const { data } = await apiClient.post<QueryResponse>('/chat/query', req);
  return data;
}

function streamHeaders(): HeadersInit {
  const token = getToken();
  return {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** One-shot refresh, mirroring apiClient's 401 interceptor — this raw fetch()
 * bypasses axios entirely (needed for a streaming body), so it doesn't get
 * that interceptor's retry-on-401 for free; this reproduces just enough of it. */
async function refreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await axios.post<{ data: { accessToken: string } }>(
      `${BASE_URL}/auth/refresh`, {}, { withCredentials: true, headers: { 'Content-Type': 'application/json' } },
    );
    const newToken = data.data.accessToken;
    setToken(newToken);
    return newToken;
  } catch {
    return null;
  }
}

/**
 * SSE streaming version — returns an async generator that yields text chunks.
 * Falls back to standard fetch if SSE is not available.
 */
export async function* postQueryStream(
  req: QueryRequest,
  signal?: AbortSignal,
): AsyncGenerator<{ chunk?: string; done?: boolean; response?: QueryResponse }> {
  let response = await fetch(`${BASE_URL}/chat/query`, {
    method: 'POST',
    headers: streamHeaders(),
    credentials: 'include',
    body: JSON.stringify(req),
    signal,
  });

  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      response = await fetch(`${BASE_URL}/chat/query`, {
        method: 'POST',
        headers: streamHeaders(),
        credentials: 'include',
        body: JSON.stringify(req),
        signal,
      });
    }
  }

  if (!response.ok || !response.body) {
    throw new Error(`Query failed: ${response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (raw === '[DONE]') {
        yield { done: true };
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed.chunk !== undefined) {
          yield { chunk: parsed.chunk };
        } else if (parsed.answer !== undefined) {
          yield { done: true, response: parsed as QueryResponse };
        }
      } catch {
        // ignore malformed events
      }
    }
  }
  yield { done: true };
}

export async function listSessions(): Promise<ChatSession[]> {
  const { data } = await apiClient.get<ChatSession[]>('/chat/sessions');
  return data;
}

export async function getSession(id: string): Promise<{ session: ChatSession; messages: import('./chat.types').ChatMessage[] }> {
  const { data } = await apiClient.get(`/chat/sessions/${id}`);
  return data;
}

export async function deleteSession(id: string): Promise<void> {
  await apiClient.delete(`/chat/sessions/${id}`);
}

export async function getDocumentLink(documentId: string): Promise<string> {
  const { data } = await apiClient.get<{ url: string }>(`/documents/${documentId}`);
  return data.url;
}
