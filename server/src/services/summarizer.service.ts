import { config } from '../config/env';
import { htmlToText } from '../lib/html-to-text';
import { logger } from '../lib/logger';

export interface ThreadMessageForSummary {
  fromName: string | null;
  fromAddress: string;
  receivedAt: Date;
  bodyText: string | null;
}

interface CachedSummary {
  /** Invalidates when the thread gains messages. */
  key: string;
  summary: string;
  model: string;
}

// Summaries are expensive (local LLM); cache per thread until new mail arrives.
const cache = new Map<string, CachedSummary>();
const MAX_CACHE = 500;

const SYSTEM_PROMPT =
  'You summarize email threads for a dashboard. Write 2-4 plain sentences covering: who is involved, ' +
  'what is being discussed or negotiated, key amounts, dates or decisions, and the current status or ' +
  'next expected action. Use only facts present in the messages — never invent details. Do not use ' +
  'markdown, bullet points, or preambles like "This thread".';

function buildPrompt(subject: string | null, messages: ThreadMessageForSummary[]): string {
  // Oldest first so the model reads the conversation in order.
  const ordered = [...messages].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

  const parts: string[] = [`Email thread subject: ${subject ?? '(no subject)'}`, ''];
  let budget = 6000; // keep the prompt well inside the model's context window

  for (const [i, m] of ordered.entries()) {
    const body = htmlToText(m.bodyText ?? '').slice(0, 900);
    const entry = [
      `--- Message ${i + 1} · From ${m.fromName ?? m.fromAddress} · ${m.receivedAt.toISOString().slice(0, 10)} ---`,
      body || '(no body stored)',
      '',
    ].join('\n');
    if (entry.length > budget) break;
    budget -= entry.length;
    parts.push(entry);
  }

  parts.push('Summarize this thread.');
  return parts.join('\n');
}

/**
 * Generate (or return cached) AI summary for a thread via the local Ollama
 * instance. Throws on any transport/model failure — callers translate to 503.
 */
export async function summarizeThread(
  threadId: string,
  subject: string | null,
  messages: ThreadMessageForSummary[],
): Promise<{ summary: string; model: string; cached: boolean }> {
  const latest = messages.reduce<number>((mx, m) => Math.max(mx, m.receivedAt.getTime()), 0);
  const key = `${messages.length}:${latest}`;

  const hit = cache.get(threadId);
  if (hit && hit.key === key) return { summary: hit.summary, model: hit.model, cached: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ollama.timeoutMs);

  try {
    const res = await fetch(`${config.ollama.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.ollama.model,
        prompt: `${SYSTEM_PROMPT}\n\n${buildPrompt(subject, messages)}`,
        stream: false,
        options: { temperature: 0.2, num_predict: 260, num_ctx: 8192 },
      }),
    });

    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);

    const data = (await res.json()) as { response?: string };
    const summary = (data.response ?? '').trim();
    if (!summary) throw new Error('Ollama returned an empty response');

    if (cache.size >= MAX_CACHE) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(threadId, { key, summary, model: config.ollama.model });

    return { summary, model: config.ollama.model, cached: false };
  } catch (err) {
    logger.warn({ err, threadId }, 'thread summary generation failed');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
