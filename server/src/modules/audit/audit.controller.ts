import type { Request, Response } from 'express';
import { ValidationError } from '../../lib/errors';
import { parseSearchParam } from '../../lib/search';
import type { AuditService } from './audit.service';
import type { AuditEntityType, AuditEventType, AuditQueryFilter } from './audit.types';

const ENTITY_TYPES: AuditEntityType[] = [
  'user',
  'organization',
  'auth_provider',
  'mailbox',
  'session',
  'attachment',
  'sync',
  'org_hierarchy',
];
const MAX_LIMIT = 200;

function parseOptionalString(v: unknown): string | undefined {
  return parseSearchParam(v);
}

function parseOptionalDate(v: unknown, field: string): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new ValidationError(`${field} must be an ISO date string`);
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new ValidationError(`${field} must be a valid ISO date string`);
  return d;
}

function parseOptionalInt(v: unknown, field: string, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1)
    throw new ValidationError(`${field} must be a positive integer`);
  return Math.min(n, max);
}

export class AuditController {
  constructor(private readonly auditSvc: AuditService) {}

  query = async (req: Request, res: Response): Promise<void> => {
    const q = req.query as Record<string, unknown>;

    const entityType = parseOptionalString(q['entityType']);
    if (entityType && !ENTITY_TYPES.includes(entityType as AuditEntityType)) {
      throw new ValidationError(`entityType must be one of: ${ENTITY_TYPES.join(', ')}`);
    }

    const filter: AuditQueryFilter = {
      actorId: parseOptionalString(q['actorId']),
      actorEmail: parseOptionalString(q['actorEmail']),
      entityType: entityType as AuditEntityType | undefined,
      entityId: parseOptionalString(q['entityId']),
      eventType: parseOptionalString(q['eventType']) as AuditEventType | undefined,
      search: parseOptionalString(q['search']),
      from: parseOptionalDate(q['from'], 'from'),
      to: parseOptionalDate(q['to'], 'to'),
      limit: parseOptionalInt(q['limit'], 'limit', MAX_LIMIT) ?? 50,
      cursor: (() => {
        const raw = q['cursor'];
        if (!raw) return undefined;
        if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
          throw new ValidationError('cursor must be a positive integer string');
        }
        return BigInt(raw);
      })(),
    };

    const limit = filter.limit ?? 50;
    const [entries, total] = await Promise.all([
      this.auditSvc.query(filter),
      this.auditSvc.count(filter),
    ]);

    const nextCursor = entries.length === limit ? String(entries[entries.length - 1]!.id) : null;

    // Bespoke top-level pagination envelope (the client reads res.data whole,
    // with nextCursor/total/totalPages at the top) — left as-is.
    res.status(200).json({
      data: entries.map((e) => ({ ...e, id: String(e.id) })),
      nextCursor,
      total,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    });
  };
}
