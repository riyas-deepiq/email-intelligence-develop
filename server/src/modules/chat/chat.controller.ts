import type { Request, Response } from 'express';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { OrgRepository } from '../organizations/org.repository';
import type { ChatService } from './chat.service';
import type { RagSourceChunk } from './clients/rag.client';

interface QueryBody {
  question?: string;
  sessionId?: string;
}

interface RagStreamEvent {
  chunk?: string;
  final?: { answer: string; chunks: RagSourceChunk[] };
}

/**
 * NOTE on response shape: every other module in this app wraps JSON bodies in
 * `{ data: ... }`. These chat/documents endpoints deliberately return bare
 * bodies instead - client/src/features/chat/chat.api.ts was already built
 * against that exact bare shape (ChatSession[], {session,messages}, {url}),
 * so this matches the established client contract rather than the server's
 * general envelope convention.
 */
export class ChatController {
  constructor(
    private readonly service: ChatService,
    private readonly orgRepo: OrgRepository,
  ) {}

  listSessions = async (req: Request, res: Response): Promise<void> => {
    const sessions = await this.service.listSessions(req.user!.id);
    res.status(200).json(sessions);
  };

  getSession = async (req: Request, res: Response): Promise<void> => {
    const result = await this.service.getSessionWithMessages(req.params['id']!, req.user!.id);
    if (!result) throw new NotFoundError('Chat session not found');
    res.status(200).json(result);
  };

  deleteSession = async (req: Request, res: Response): Promise<void> => {
    const deleted = await this.service.deleteSession(req.params['id']!, req.user!.id);
    // Same 404 whether it never existed or belongs to someone else — no
    // signal about other users' conversations.
    if (!deleted) throw new NotFoundError('Chat session not found');
    res.status(204).send();
  };

  query = async (req: Request, res: Response): Promise<void> => {
    const body = req.body as QueryBody;
    const question = body.question?.trim();
    if (!question) throw new ValidationError('question is required');

    const user = req.user!;
    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');

    const mailboxIds = await this.service.resolveMailboxScope(user, org.id);
    const sessionId = await this.service.ensureSession(body.sessionId, org.id, user.id, question);
    const startedAt = Date.now();

    const wantsStream = (req.headers.accept ?? '').includes('text/event-stream');

    if (!wantsStream) {
      try {
        const ragRes = await this.service.ask(question, mailboxIds);
        const sourceCitations = this.service.toCitations(ragRes.chunks);
        const citations = this.service.shouldAttachSearchSources(question) ? sourceCitations : [];
        const grounding = this.service.groundingFrom(sourceCitations);
        await this.service.recordTurn(sessionId, question, ragRes.answer, citations, grounding);
        await this.service.recordSearchAnalytics({
          orgId: org.id,
          userId: user.id,
          question,
          responseMs: Number.isFinite(ragRes.elapsed_ms)
            ? ragRes.elapsed_ms
            : Date.now() - startedAt,
          success: true,
        });
        res.status(200).json({ answer: ragRes.answer, citations, grounding, sessionId });
      } catch (err) {
        await this.service.recordSearchAnalytics({
          orgId: org.id,
          userId: user.id,
          question,
          responseMs: Date.now() - startedAt,
          success: false,
        });
        throw err;
      }
      return;
    }

    await this.streamQuery(req, res, question, sessionId, mailboxIds, org.id, user.id);
  };

  /**
   * Relays RAG's SSE stream to the client, reshaping each event along the way:
   * token events pass through as-is; RAG's final `{final:{answer,chunks}}`
   * event becomes the client's expected `{answer,citations,grounding,sessionId}`
   * - persisting the conversation turn at that point, since that's the first
   * moment the full answer + citations both exist.
   */
  private async streamQuery(
    req: Request,
    res: Response,
    question: string,
    sessionId: string,
    mailboxIds: string[],
    orgId: string,
    userId: string,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const startedAt = Date.now();
    let analyticsRecorded = false;
    const recordAnalytics = async (success: boolean): Promise<void> => {
      analyticsRecorded = true;
      await this.service.recordSearchAnalytics({
        orgId,
        userId,
        question,
        responseMs: Date.now() - startedAt,
        success,
      });
    };

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    try {
      const ragStream = await this.service.stream(question, mailboxIds, abortController.signal);
      const reader = ragStream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let done = false;

      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (done || !result.value) continue;
        const value = result.value;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const raw = line.slice(5).trim();
          if (raw === '[DONE]') continue; // we emit our own [DONE] once persistence is done

          let parsed: RagStreamEvent;
          try {
            parsed = JSON.parse(raw);
          } catch {
            continue;
          }

          if (parsed.chunk !== undefined) {
            res.write(`data: ${JSON.stringify({ chunk: parsed.chunk })}\n\n`);
          } else if (parsed.final) {
            const sourceCitations = this.service.toCitations(parsed.final.chunks);
            const citations = this.service.shouldAttachSearchSources(question)
              ? sourceCitations
              : [];
            const grounding = this.service.groundingFrom(sourceCitations);
            await this.service.recordTurn(
              sessionId,
              question,
              parsed.final.answer,
              citations,
              grounding,
            );
            await recordAnalytics(true);
            res.write(
              `data: ${JSON.stringify({ answer: parsed.final.answer, citations, grounding, sessionId })}\n\n`,
            );
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Chat stream failed');
      if (!analyticsRecorded) await recordAnalytics(false);
      // Headers are already sent for SSE - can't switch to a JSON error
      // response, so degrade gracefully with a fallback assistant message.
      res.write(
        `data: ${JSON.stringify({
          answer: 'Something went wrong. Please try again.',
          citations: [],
          grounding: 'not_found',
          sessionId,
        })}\n\n`,
      );
    } finally {
      if (!analyticsRecorded && !abortController.signal.aborted) await recordAnalytics(false);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
}
