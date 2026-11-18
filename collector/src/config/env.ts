import { z } from 'zod';
import { loadEnvFile } from './env-file';

loadEnvFile();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  SERVER_URL: z.string().url().default('http://localhost:3000'),

  COLLECTOR_SECRET: z.string().min(16, 'COLLECTOR_SECRET must be at least 16 characters'),

  COLLECTOR_INSTANCE_ID: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),

  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(10),
  JOB_HEARTBEAT_MS: z.coerce.number().int().positive().default(120_000),
  FLUSH_MAX_MESSAGES: z.coerce.number().int().positive().default(50),
  FLUSH_MAX_SIZE_MB: z.coerce.number().positive().default(50),
  FLUSH_MAX_AGE_MS: z.coerce.number().int().positive().default(10_000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = JSON.stringify(parsed.error.flatten().fieldErrors);
  process.stderr.write(`Invalid collector environment variables: ${errors}\n`);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
