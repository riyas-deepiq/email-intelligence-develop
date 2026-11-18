import type { NextFunction, Request, Response } from 'express';
import { send } from '../../lib/respond';
import { asyncHandler } from '../../lib/async-handler';
import { actorFromRequest } from '../audit/audit.service';
import { parseConnectPayload, parseTestPayload } from './provider-connection.schema';
import { ProviderConnectionService } from './provider-connection.service';

export class ProviderConnectionController {
  constructor(private readonly service: ProviderConnectionService) {}

  testConnection = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const payload = parseTestPayload(req.body);
    const result = await this.service.testConnection(payload);
    res.json(result);
  });

  connect = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const payload = parseConnectPayload(req.body);
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const result = await this.service.connect(payload, actor);
    res.status(201).json(result);
  });

  getStatus = asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    const result = await this.service.getStatus();
    res.json(result);
  });

  getConfig = asyncHandler(async (_req: Request, res: Response, _next: NextFunction) => {
    const result = await this.service.getSavedConfig();
    res.json(result);
  });

  resync = asyncHandler(async (req: Request, res: Response, _next: NextFunction) => {
    const { mailboxIds } = req.body as { mailboxIds?: unknown };
    const ids = Array.isArray(mailboxIds)
      ? (mailboxIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : undefined;
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const result = await this.service.resync(ids, actor);
    send(res, result);
  });
}
