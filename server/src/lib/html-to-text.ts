/**
 * Convert an email body that may contain HTML into readable plain text.
 * Collector stores bodies as-is; M365 messages usually arrive as full HTML
 * documents, so previews/summaries must strip markup before display.
 */
export function htmlToText(input: string): string {
  if (!/[<&]/.test(input)) return input.trim();

  let s = input;
  // Drop non-content blocks entirely (styles, scripts, head, comments).
  s = s.replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Block-level closings and <br> become line breaks so paragraphs survive.
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n');
  // Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode the entities that commonly appear in email HTML.
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = parseInt(code, 10);
      return n > 31 && n < 65536 ? String.fromCharCode(n) : ' ';
    })
    .replace(/&amp;/gi, '&');
  // Collapse whitespace while keeping paragraph breaks.
  s = s.replace(/[ \t\r]+/g, ' ');
  s = s.replace(/ ?\n ?/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Signatures that mark the start of a quoted reply chain in a plain-text body —
// each prior message in the thread is already its own row, so quoting them
// inline just duplicates content the UI already shows as separate messages.
const QUOTE_PATTERNS: RegExp[] = [
  // Outlook-style header block: From: ... / Sent|Date: ... / [To:] / [Cc:] / Subject: ...
  /\n\s*From:\s*.+\n\s*(?:Sent|Date):\s*.+\n(?:\s*To:\s*.+\n)?(?:\s*Cc:\s*.+\n)?\s*Subject:\s*.+/i,
  // Gmail / Apple Mail style: "On <date>, <name> wrote:"
  /\n\s*On\s.{0,120}?wrote:\s*\n/i,
  // Classic separator used by many clients
  /\n\s*-{2,}\s*Original Message\s*-{2,}/i,
];

/** Truncates a plain-text email body at the start of any quoted reply chain. */
export function stripQuotedReply(text: string): string {
  let cutIndex = text.length;
  for (const pattern of QUOTE_PATTERNS) {
    const m = text.match(pattern);
    if (m && m.index !== undefined && m.index < cutIndex) cutIndex = m.index;
  }
  return text.slice(0, cutIndex).trim();
}
