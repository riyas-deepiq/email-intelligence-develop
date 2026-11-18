// Runs before any test file imports application code (vitest setupFiles).
// config/env.ts validates process.env at import time and exits on failure,
// so required values must exist before the first transitive import.
process.env['COLLECTOR_SECRET'] ??= 'test-collector-secret';
process.env['LOG_LEVEL'] = 'silent';

// Small flush thresholds so MessageBuffer tests can trigger auto-flushes
// with a handful of tiny messages.
process.env['FLUSH_MAX_MESSAGES'] = '3';
process.env['FLUSH_MAX_SIZE_MB'] = '1';
process.env['FLUSH_MAX_AGE_MS'] = '60000';
