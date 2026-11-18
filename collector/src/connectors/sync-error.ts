/**
 * Provider-neutral failure contract for mailbox synchronization.
 *
 * Microsoft Graph can add error codes at any time.  We preserve the provider
 * code for diagnostics, but the worker acts on a stable category/action pair.
 */
export enum SyncErrorCategory {
  Authentication = 'authentication',
  Authorization = 'authorization',
  Mailbox = 'mailbox',
  Message = 'message',
  Delta = 'delta',
  Attachment = 'attachment',
  Throttling = 'throttling',
  Transient = 'transient',
  Network = 'network',
  Webhook = 'webhook',
  Internal = 'internal',
}

export enum SyncRecoveryAction {
  Retry = 'retry',
  Continue = 'continue',
  Pause = 'pause',
  Reconnect = 'reconnect',
  FullResync = 'full_resync',
}

export enum SyncErrorSeverity {
  Info = 'info',
  Warning = 'warning',
  Error = 'error',
  Critical = 'critical',
}

export interface SyncErrorDetails {
  provider: 'm365';
  category: SyncErrorCategory;
  severity: SyncErrorSeverity;
  action: SyncRecoveryAction;
  retryable: boolean;
  httpStatus?: number;
  providerCode?: string;
  requestId?: string;
  clientRequestId?: string;
  retryAfterMs?: number;
  userMessage: string;
  developerMessage: string;
}

export class SyncError extends Error {
  readonly details: SyncErrorDetails;

  constructor(details: SyncErrorDetails) {
    super(details.developerMessage);
    this.name = 'SyncError';
    this.details = details;
  }

  /** Structured, safe-to-persist form. Never put tokens or raw bodies here. */
  toJSON(): SyncErrorDetails {
    return this.details;
  }
}

export function isSyncError(error: unknown): error is SyncError {
  return error instanceof SyncError;
}

type GraphErrorBody = {
  error?: {
    code?: string;
    message?: string;
    innerError?: GraphErrorBody['error'];
    innererror?: GraphErrorBody['error'];
  };
};

function nestedCode(error: GraphErrorBody['error']): string | undefined {
  let current = error;
  let code = current?.code;
  while (current?.innerError ?? current?.innererror) {
    current = current.innerError ?? current.innererror;
    code = current?.code ?? code;
  }
  return code;
}

export function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

/** Converts an OAuth or Graph HTTP failure to a stable sync decision. */
export function classifyM365Error(input: {
  status?: number;
  body?: unknown;
  requestId?: string | null;
  clientRequestId?: string | null;
  retryAfter?: string | null;
  context: string;
}): SyncError {
  const body = input.body as GraphErrorBody | undefined;
  const providerCode = nestedCode(body?.error) ?? (body as { error?: string } | undefined)?.error;
  const status = input.status;
  const common = {
    provider: 'm365' as const,
    httpStatus: status,
    providerCode,
    requestId: input.requestId ?? undefined,
    clientRequestId: input.clientRequestId ?? undefined,
    retryAfterMs: retryAfterMs(input.retryAfter ?? null),
    developerMessage: `${input.context}${status ? ` (${status})` : ''}${providerCode ? `: ${providerCode}` : ''}`,
  };

  // Delta cursors are disposable: never retry the same invalid URL; start a
  // new baseline and let server-side deduplication make the replay safe.
  if (status === 410 || providerCode?.toLowerCase() === 'syncstatenotfound') {
    return new SyncError({
      ...common,
      category: SyncErrorCategory.Delta,
      severity: SyncErrorSeverity.Warning,
      action: SyncRecoveryAction.FullResync,
      retryable: false,
      userMessage: 'The mailbox change cursor expired. Syncing history again.',
    });
  }
  if (
    status === 429 ||
    status === 503 ||
    status === 504 ||
    status === 502 ||
    status === 500 ||
    status === 408
  ) {
    return new SyncError({
      ...common,
      category: status === 429 ? SyncErrorCategory.Throttling : SyncErrorCategory.Transient,
      severity: SyncErrorSeverity.Warning,
      action: SyncRecoveryAction.Retry,
      retryable: true,
      userMessage: 'Microsoft 365 is temporarily busy. Sync will retry automatically.',
    });
  }
  if (
    status === 401 ||
    ['invalid_grant', 'invalid_client', 'invalidauthenticationtoken'].includes(
      providerCode?.toLowerCase() ?? '',
    )
  ) {
    return new SyncError({
      ...common,
      category: SyncErrorCategory.Authentication,
      severity: SyncErrorSeverity.Error,
      action: SyncRecoveryAction.Reconnect,
      retryable: false,
      userMessage: 'The Microsoft 365 connection needs to be reconnected.',
    });
  }
  if (
    status === 403 ||
    [
      'access_denied',
      'unauthorized_client',
      'consent_required',
      'interaction_required',
      'erroraccessdenied',
    ].includes(providerCode?.toLowerCase() ?? '')
  ) {
    return new SyncError({
      ...common,
      category: SyncErrorCategory.Authorization,
      severity: SyncErrorSeverity.Error,
      action: SyncRecoveryAction.Pause,
      retryable: false,
      userMessage:
        'Microsoft 365 denied access to this mailbox. Ask an administrator to review permissions and policies.',
    });
  }
  if (status === 404) {
    return new SyncError({
      ...common,
      category: SyncErrorCategory.Mailbox,
      severity: SyncErrorSeverity.Error,
      action: SyncRecoveryAction.Pause,
      retryable: false,
      userMessage: 'The Microsoft 365 mailbox or resource is no longer available.',
    });
  }
  return new SyncError({
    ...common,
    category: SyncErrorCategory.Internal,
    severity: SyncErrorSeverity.Error,
    action: SyncRecoveryAction.Pause,
    retryable: false,
    userMessage: 'Microsoft 365 could not process this sync request.',
  });
}

export function classifyM365NetworkError(error: unknown, context: string): SyncError {
  const cause = error as { code?: string; message?: string };
  return new SyncError({
    provider: 'm365',
    category: SyncErrorCategory.Network,
    severity: SyncErrorSeverity.Warning,
    action: SyncRecoveryAction.Retry,
    retryable: true,
    providerCode: cause?.code,
    userMessage: 'The connection to Microsoft 365 was interrupted. Sync will retry automatically.',
    developerMessage: `${context}: ${cause?.code ?? cause?.message ?? String(error)}`,
  });
}
