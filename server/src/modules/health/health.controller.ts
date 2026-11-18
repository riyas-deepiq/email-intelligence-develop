import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Request, Response } from 'express';

// Read once at module load — package.json never changes at runtime.
const { version } = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as {
  version: string;
};

/** Liveness/readiness probe. Kept dependency-free so it stays fast and always answers. */
export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'healthy',
    version,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
}
