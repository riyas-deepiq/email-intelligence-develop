import type { Request, Response } from 'express';
import { send } from '../../lib/respond';
import { ForbiddenError, ValidationError } from '../../lib/errors';
import { actorFromRequest } from '../audit/audit.service';
import type { OrgHierarchyService } from './org-hierarchy.service';
import type { PositionInput, AddNodeInput } from './org-hierarchy.types';
import type { AuditActor } from '../audit/audit.types';

export function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
  ) {
    throw new ValidationError('A valid UUID is required');
  }
  return value.trim().toLowerCase();
}
function body(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('JSON object required');
  return value as Record<string, unknown>;
}
export function parseManagers(value: unknown): string[] {
  if (!Array.isArray(value)) throw new ValidationError('managerNodeIds must be an array');
  const ids = value.map(uuid);
  if (new Set(ids).size !== ids.length)
    throw new ValidationError('Duplicate managers are not allowed');
  return ids;
}
export function parseUpdateBody(value: unknown): Partial<PositionInput> {
  const b = body(value);
  const result: Partial<PositionInput> = {};
  if ('title' in b) {
    if (typeof b.title !== 'string' || !b.title.trim() || b.title.trim().length > 200)
      throw new ValidationError('Title must contain 1–200 characters');
    result.title = b.title.trim();
  }
  if ('department' in b) {
    if (b.department !== null && (typeof b.department !== 'string' || b.department.length > 200))
      throw new ValidationError('Invalid department');
    result.department = typeof b.department === 'string' ? b.department.trim() || null : null;
  }
  if ('sortOrder' in b) {
    if (
      typeof b.sortOrder !== 'number' ||
      !Number.isInteger(b.sortOrder) ||
      Math.abs(b.sortOrder) > 2147483647
    )
      throw new ValidationError('Invalid display order');
    result.sortOrder = b.sortOrder;
  }
  if (!Object.keys(result).length)
    throw new ValidationError('At least one position field is required');
  return result;
}
export function parseAddBody(value: unknown): AddNodeInput {
  const b = body(value);
  const patch = parseUpdateBody(b);
  if (!patch.title) throw new ValidationError('Title is required');
  return {
    ...patch,
    title: patch.title,
    managerNodeIds: parseManagers(b.managerNodeIds === undefined ? [] : b.managerNodeIds),
    userId: b.userId === undefined || b.userId === null ? null : uuid(b.userId),
  };
}
const actor = (req: Request): AuditActor | undefined =>
  req.user ? actorFromRequest(req.user, req.ip) : undefined;

export class OrgHierarchyController {
  constructor(private readonly service: OrgHierarchyService) {}
  getTree = async (_req: Request, res: Response): Promise<void> => {
    send(res, await this.service.getTree());
  };
  addNode = async (req: Request, res: Response): Promise<void> => {
    send(res, await this.service.create(parseAddBody(req.body), actor(req)), 'OK', 201);
  };
  updateNode = async (req: Request, res: Response): Promise<void> => {
    send(
      res,
      await this.service.mutate(
        { type: 'update', nodeId: uuid(req.params.nodeId), input: parseUpdateBody(req.body) },
        actor(req),
      ),
    );
  };
  managers = async (req: Request, res: Response): Promise<void> => {
    send(
      res,
      await this.service.mutate(
        {
          type: 'managers',
          nodeId: uuid(req.params.nodeId),
          managerNodeIds: parseManagers(body(req.body).managerNodeIds),
        },
        actor(req),
      ),
    );
  };
  assignment = async (req: Request, res: Response): Promise<void> => {
    const value = body(req.body).userId;
    send(
      res,
      await this.service.mutate(
        {
          type: 'assignment',
          nodeId: uuid(req.params.nodeId),
          userId: value === null ? null : uuid(value),
        },
        actor(req),
      ),
    );
  };
  removeNode = async (req: Request, res: Response): Promise<void> => {
    await this.service.mutate({ type: 'delete', nodeId: uuid(req.params.nodeId) }, actor(req));
    res.status(204).send();
  };
  getScope = async (req: Request, res: Response): Promise<void> => {
    const userId = uuid(req.params.userId);
    if (req.user!.role !== 'superadmin' && req.user!.id !== userId)
      throw new ForbiddenError('You may only view your own scope');
    const scope = await this.service.getScope(userId);
    // Path details reveal identities; only the management preview receives them.
    send(res, req.user!.role === 'superadmin' ? scope : { userId, mailboxIds: scope.mailboxIds });
  };
}
