import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { deleteSession, getSession, listSessions, postQueryStream } from '../chat.api';
import type { ChatMessage, ChatSession, Citation } from '../chat.types';
import { Spinner } from '../../../shared/components/Spinner';
import ChatBubbleIcon from '@/assets/icons/message.svg?react';
import ExternalLinkIcon from '@/assets/icons/external-link.svg?react';
import IcLayers from '@/assets/icons/layers.svg?react';
import PlusIcon from '@/assets/icons/plus.svg?react';
import SendIcon from '@/assets/icons/send.svg?react';
import TrashIcon from '@/assets/icons/trash.svg?react';
import { useToast } from '@/shared/toast/useToast';
import { BrandText } from '@/shared/components/BrandText';
import { BRAND_NAME } from '@/shared/brand';
import { View, viewPath } from '@/features/dashboard/dashboard.types';
import styles from '@/styles/features/chat/pages/Chat.module.css';

/* Typing dots */
function TypingDots() {
  return (
    <span className={styles.typingDots} aria-label="AI is typing">
      {[0, 1, 2].map(i => <span key={i} className={styles.dot} style={{ animationDelay: `${i * 0.18}s` }} />)}
    </span>
  );
}

/* Citation card */
function CitationCard({ citation, onReply }: { citation: Citation; onReply: (citation: Citation) => void }) {
  const navigate = useNavigate();

  const handleOpen = () => {
    const messageId = citation.messageId || citation.documentId;
    navigate(`${viewPath(View.Emails)}?messageId=${encodeURIComponent(messageId)}`);
  };

  return (
    <div className={styles.citation}>
      <div className={styles.citationHeader}>
        <span className={styles.citationSubject}>{citation.subject}</span>
        <span className={styles.citationDate}>
          {new Date(citation.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      </div>
      <div className={styles.citationFrom}>{citation.from}</div>
      {citation.snippet && <p className={styles.citationSnippet}>&ldquo;{citation.snippet}&rdquo;</p>}
      <div className={styles.citationActions}>
        <button
          className={`${styles.citationAction} ${styles.citationReply}`}
          onClick={() => onReply(citation)}
          type="button"
          aria-label={`Reply about ${citation.subject}`}
        >
          <ChatBubbleIcon width={12} height={12} />
          Reply
        </button>
        <button
          className={`${styles.citationAction} ${styles.citationLink}`}
          onClick={handleOpen}
          type="button"
        >
          <ExternalLinkIcon width={12} height={12} />
          View source
        </button>
      </div>
    </div>
  );
}

/* Message bubble */
function MessageBubble({ msg, onCitationReply }: { msg: ChatMessage; onCitationReply: (citation: Citation) => void }) {
  const isUser = msg.role === 'user';
  const time = new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`${styles.msgRow} ${isUser ? styles.msgRowUser : ''}`}>
      {!isUser && (
        <div className={styles.aiAvatar}>
          <IcLayers width={14} height={14} />
        </div>
      )}
      <div className={`${styles.bubble} ${isUser ? styles.bubbleUser : styles.bubbleAI}`}>
        <div className={styles.bubbleMeta}>
          <span className={styles.bubbleAuthor}>{isUser ? 'You' : BRAND_NAME}</span>
          <span className={styles.bubbleTime}>{time}</span>
        </div>
        {msg.streaming && !msg.content ? (
          <TypingDots />
        ) : (
          <p className={styles.bubbleText}>{msg.content}</p>
        )}
        {!isUser && msg.citations && msg.citations.length > 0 && (
          <div className={styles.citations}>
            <span className={styles.citationsLabel}>
              {msg.citations.length} source{msg.citations.length !== 1 ? 's' : ''}
            </span>
            <div className={styles.citationGrid}>
              {msg.citations.map(c => (
                <CitationCard key={c.messageId} citation={c} onReply={onCitationReply} />
              ))}
            </div>
          </div>
        )}
        {!isUser && msg.grounding === 'not_found' && (
          <p className={styles.notFound}>No matching emails found in your accessible scope.</p>
        )}
      </div>
    </div>
  );
}

/* Session item */
/**
 * A row is a container rather than one big button: the delete control has to be
 * a sibling of the open control, since nesting a button inside a button is
 * invalid HTML and breaks keyboard activation.
 */
function SessionItem({
  session, active, onClick, onDelete, deleting,
}: {
  session:  ChatSession;
  active:   boolean;
  onClick:  () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className={`${styles.sessionItem} ${active ? styles.sessionActive : ''}`}>
      <button className={styles.sessionMain} onClick={onClick} type="button">
        <span className={styles.sessionTitle}>{session.title || 'Untitled'}</span>
        {session.lastMessage && (
          <span className={styles.sessionSnippet}>{session.lastMessage}</span>
        )}
      </button>

      {confirming ? (
        // Inline confirm rather than a modal — deleting a conversation is
        // low-stakes but irreversible, so it needs a second step, not a dialog.
        <span className={styles.sessionConfirm}>
          <button
            type="button"
            className={styles.sessionConfirmYes}
            onClick={onDelete}
            disabled={deleting}
            title="Confirm delete"
          >
            {deleting ? '…' : 'Delete'}
          </button>
          <button
            type="button"
            className={styles.sessionConfirmNo}
            onClick={() => setConfirming(false)}
            disabled={deleting}
            title="Cancel"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={styles.sessionDelete}
          onClick={() => setConfirming(true)}
          title="Delete conversation"
          aria-label={`Delete conversation: ${session.title || 'Untitled'}`}
        >
          <TrashIcon width={13} height={13} />
        </button>
      )}
    </div>
  );
}


export function Chat() {
  const toast = useToast();
  const qc = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [streaming, setStreaming] = useState(false);
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null);
  const [loadingSession, setLoadingSession] = useState(false);

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const shouldStickToBottomRef = useRef(true);

  const { data: sessions, refetch: refetchSessions } = useQuery({
    queryKey: ['chat-sessions'],
    queryFn: listSessions,
    retry: false,
  });
  const sessionCount = sessions?.length ?? 0;

  const updateScrollStickiness = useCallback(() => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 80;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!shouldStickToBottomRef.current) return;
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleMessagesScroll = useCallback(() => {
    updateScrollStickiness();
  }, [updateScrollStickiness]);

  const handleChatWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const messagesEl = messagesRef.current;
    const target = event.target;
    if (!messagesEl || !(target instanceof Node) || messagesEl.contains(target)) return;
    if (target instanceof HTMLElement && target.closest('textarea')) return;
    if (messagesEl.scrollHeight <= messagesEl.clientHeight) return;

    messagesEl.scrollTop += event.deltaY;
    updateScrollStickiness();
    event.preventDefault();
  }, [updateScrollStickiness]);

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  };

  const handleCitationReply = useCallback((citation: Citation) => {
    const dateLabel = citation.date
      ? new Date(citation.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    const contextParts = [
      citation.subject ? `"${citation.subject}"` : 'this email',
      citation.from ? `from ${citation.from}` : '',
      dateLabel ? `on ${dateLabel}` : '',
    ].filter(Boolean);
    const draft = `Regarding ${contextParts.join(' ')}: `;

    setInput(draft);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(draft.length, draft.length);
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    });
  }, []);

  const startNew = () => {
    shouldStickToBottomRef.current = true;
    setMessages([]);
    setSessionId(undefined);
    setInput('');
  };

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSession(id),
    onSuccess: (_data, id) => {
      // Deleting the conversation you're reading would otherwise leave its
      // messages on screen pointing at a session that no longer exists.
      if (id === sessionId) {
        shouldStickToBottomRef.current = true;
        setMessages([]);
        setSessionId(undefined);
        setInput('');
      }
      qc.invalidateQueries({ queryKey: ['chat-sessions'] });
      toast.success('Conversation deleted.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Failed to delete conversation.';
      toast.error(msg);
    },
  });

  const openSession = useCallback(async (id: string) => {
    shouldStickToBottomRef.current = true;
    setSessionId(id);
    setLoadingSession(true);
    try {
      const { messages: history } = await getSession(id);
      setMessages(history);
    } catch {
      setMessages([]);
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const sendMessage = useCallback(async (question: string) => {
    if (!question.trim() || streaming) return;

    shouldStickToBottomRef.current = true;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      createdAt: new Date().toISOString(),
    };
    const aiMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      streaming: true,
    };

    setMessages(prev => [...prev, userMsg, aiMsg]);
    setInput('');
    setStreaming(true);
    if (textareaRef.current) { textareaRef.current.style.height = 'auto'; }

    const ctrl = new AbortController();
    setAbortCtrl(ctrl);

    let accumulated = '';
    let finalResponse: import('../chat.types').QueryResponse | undefined;

    try {
      const gen = postQueryStream({ question, sessionId }, ctrl.signal);
      for await (const event of gen) {
        if (event.chunk) {
          accumulated += event.chunk;
          setMessages(prev =>
            prev.map(m => m.id === aiMsg.id ? { ...m, content: accumulated } : m)
          );
        }
        if (event.done && event.response) {
          finalResponse = event.response;
        }
        if (event.done) break;
      }

      // Finalise
      setMessages(prev =>
        prev.map(m =>
          m.id === aiMsg.id
            ? {
                ...m,
                content: finalResponse?.answer ?? accumulated,
                citations: finalResponse?.citations ?? [],
                grounding: finalResponse?.grounding,
                streaming: false,
              }
            : m
        )
      );

      if (finalResponse?.sessionId) {
        setSessionId(finalResponse.sessionId);
        refetchSessions();
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        setMessages(prev =>
          prev
            .map(m => m.id === aiMsg.id ? { ...m, content: accumulated, streaming: false } : m)
            .filter(m => m.id !== aiMsg.id || Boolean(accumulated.trim()))
        );
        return;
      }
      setMessages(prev => prev.filter(m => m.id !== aiMsg.id));
      toast.error('AI interface is not connected. Please try again when it is available.');
    } finally {
      setStreaming(false);
      setAbortCtrl(null);
    }
  }, [streaming, sessionId, refetchSessions, toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  // Enter sends, Shift+Enter inserts a newline. Ctrl/Cmd+Enter still sends too,
  // so the older habit keeps working. isComposing guards IME input, where Enter
  // commits a candidate rather than ending the message.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    if (e.shiftKey) return;
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <div className={styles.page}>
      {/* Main chat area */}
      <div className={styles.chatArea} onWheel={handleChatWheel}>
        <div className={styles.chatHeader}>
          <div>
            <span className={styles.chatEyebrow}>Search intelligence</span>
            <h2 className={styles.chatTitle}>
              <BrandText className={styles.chatBrand} />
            </h2>
          </div>
          <span className={styles.chatState}>
            <span className={styles.chatStateDot} />
            AI search
          </span>
        </div>

        {/* Messages */}
        <div ref={messagesRef} className={styles.messages} onScroll={handleMessagesScroll}>
          {loadingSession ? (
            <div className={styles.emptyChat}>
              <Spinner />
            </div>
          ) : messages.length === 0 ? (
            <div className={styles.emptyChat}>
              <div className={styles.emptyIcon}>
                <ChatBubbleIcon width={26} height={26} />
              </div>
              <div className={styles.emptyCopy}>
                <h3 className={styles.emptyTitle}>Ask {BRAND_NAME} about your connected knowledge</h3>
              </div>

            </div>
          ) : (
            messages.map(msg => <MessageBubble key={msg.id} msg={msg} onCitationReply={handleCitationReply} />)
          )}
        </div>

        {/* Input bar */}
        <div className={styles.inputBar}>
          <form className={styles.inputForm} onSubmit={handleSubmit}>
            <textarea
              ref={textareaRef}
              className={styles.input}
              value={input}
              onChange={e => { setInput(e.target.value); autoGrow(); }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your connected business data..."
              rows={1}
              disabled={streaming}
            />
            <div className={styles.inputActions}>
              {streaming ? (
                <button
                  className={styles.stopBtn}
                  type="button"
                  onClick={() => abortCtrl?.abort()}
                  aria-label="Stop generation"
                >
                  <span className={styles.stopSquare} />
                </button>
              ) : (
                <button
                  className={styles.sendBtn}
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Send"
                >
                  <SendIcon width={16} height={16} />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Sessions panel */}
      <aside className={styles.sessionsPanel}>
        <div className={styles.sessionsPanelHeader}>
          <div className={styles.sessionsTitleWrap}>
            <span className={styles.sessionsPanelTitle}>Conversations</span>
            <span className={styles.sessionsCount}>{sessionCount}</span>
          </div>
          <button className={styles.newChatBtn} onClick={startNew} type="button" title="New chat">
            <PlusIcon width={16} height={16} />
          </button>
        </div>
        <div className={styles.sessionsList}>
          {sessions && sessions.length > 0 ? (
            sessions.map(s => (
              <SessionItem
                key={s.id}
                session={s}
                active={s.id === sessionId}
                onClick={() => openSession(s.id)}
                onDelete={() => deleteMut.mutate(s.id)}
                deleting={deleteMut.isPending && deleteMut.variables === s.id}
              />
            ))
          ) : (
            <p className={styles.noSessions}>No past conversations</p>
          )}
        </div>
      </aside>
    </div>
  );
}
