import { loadEnvFile } from './env-file';
import { PRODUCT_NAME } from './brand';

// Load `.env` before anything below reads process.env. Unlike `dotenv/config`
// this honours INSIGHT_HUB_CONFIG_DIR, so an installed service finds its config even
// though the binary lives in a read-only directory. See ./env-file.ts.
loadEnvFile();

// Application configuration — all values read directly from process.env with
// safe defaults, grouped by domain (same pattern as the project's config files).

export const config = {
  // Server
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),

  server: {
    logLevel: process.env.LOG_LEVEL || 'info',
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:8080',
  },

  // Database
  // DB_DRIVER=memory skips Postgres entirely (tests and DB-less local runs).
  database: {
    driver: (process.env.DB_DRIVER || 'postgres') as 'postgres' | 'memory',
    url: process.env.DATABASE_URL || undefined, // required when driver=postgres
  },

  // Auth / JWT
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production-min-32-chars!!',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m', // access token TTL
    refreshTokenTtlSec: parseInt(process.env.REFRESH_TOKEN_TTL_SEC || `${60 * 60 * 24 * 7}`, 10), // 7 days

    // AES-256-GCM key for encrypting stored OAuth client secrets.
    // Must be a 64-char lowercase hex string — generate with:
    //   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
    // WARNING: the default below is a placeholder — MUST be replaced in production.
    oidcEncryptionKey:
      process.env.OIDC_ENCRYPTION_KEY ||
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',

    // Credentials used ONCE on first startup to create the default Super Admin.
    // Installed deployments create their administrator through `admin:create`
    // during setup and set SEED_DEFAULT_ADMIN=false, so that no account with a
    // well-known default password can ever exist on a customer's machine.
    seed: {
      enabled: process.env.SEED_DEFAULT_ADMIN !== 'false',
      adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@insight-hub.local',
      adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@1234!',
    },
  },

  // Session store (Redis)
  // When unset the server uses an in-memory session store (dev / test only).
  session: {
    redisUrl: process.env.REDIS_URL || undefined,
  },

  // Collector service
  // Internal HTTP URL of the Collector worker that performs email ingestion.
  // When COLLECTOR_URL is unset the server still works — probe/sync triggers are
  // skipped with a debug log (useful for running the server without the collector).
  collector: {
    url: process.env.COLLECTOR_URL || undefined,
    secret: process.env.COLLECTOR_SECRET || 'dev-collector-secret',
  },

  // Ollama (local LLM for AI thread summaries)
  // Same instance the RAG service uses. When unreachable, summary endpoints
  // return 503 and the client falls back to derived thread facts.
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model: process.env.OLLAMA_MODEL || 'llama3.2',
    timeoutMs: parseInt(process.env.OLLAMA_TIMEOUT_MS || '120000', 10),
  },

  // RAG service (email search + chat)
  // Internal HTTP URL of the Python RAG FastAPI service. The chat module calls
  // it directly (query/ask, query/stream) with a mailbox scope already
  // resolved from this server's own org-hierarchy/RBAC data — RAG never
  // re-derives identity itself for these calls.
  ragApi: {
    url: process.env.RAG_API_URL || 'http://127.0.0.1:8000',
    secret: process.env.RAG_API_SECRET || undefined, // must match RAG's RAG_INTERNAL_SECRET when set
  },

  // SMTP / Mailer
  // All optional — when host is absent, outbound email is logged and skipped.
  smtp: {
    host: process.env.SMTP_HOST || undefined,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM || `${PRODUCT_NAME} <noreply@insight-hub.local>`,
  },
};

// Production guards — exit immediately so a misconfigured server never starts.

function exitWithConfigError(message: string): never {
  process.stderr.write(`[env] ${message}\n`);
  process.exit(1);
}

if (config.env === 'production') {
  const PLACEHOLDER_KEY = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const DEFAULT_JWT = 'change-me-in-production-min-32-chars!!';
  const DEFAULT_SECRET = 'dev-collector-secret';

  if (config.auth.oidcEncryptionKey === PLACEHOLDER_KEY) {
    exitWithConfigError(
      'OIDC_ENCRYPTION_KEY is still the placeholder value — set a unique 64-char hex string in production.',
    );
  }
  if (!/^[0-9a-f]{64}$/i.test(config.auth.oidcEncryptionKey)) {
    exitWithConfigError(
      'OIDC_ENCRYPTION_KEY must be a 64-character hex string (32 bytes for AES-256).',
    );
  }
  if (config.auth.jwtSecret === DEFAULT_JWT || config.auth.jwtSecret.length < 32) {
    exitWithConfigError(
      'JWT_SECRET must be set to a strong random value of at least 32 characters in production.',
    );
  }
  if (config.collector.secret === DEFAULT_SECRET) {
    exitWithConfigError('COLLECTOR_SECRET must be set to a strong random value in production.');
  }
}
