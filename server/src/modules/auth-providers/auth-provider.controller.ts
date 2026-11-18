import type { Request, Response } from 'express';
import { send } from '../../lib/respond';
import { actorFromRequest } from '../audit/audit.service';
import { parseProviderParam, parseUpdateAuthProviderDto } from './auth-provider.schema';
import type { AuthProviderService } from './auth-provider.service';

export class AuthProviderController {
  constructor(private readonly service: AuthProviderService) {}

  listAll = async (_req: Request, res: Response): Promise<void> => {
    const providers = await this.service.listAll();
    send(res, providers);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const { provider } = parseProviderParam(req.params as Record<string, string>);
    const dto = parseUpdateAuthProviderDto(req.body);
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const result = await this.service.updateProvider(provider, dto, actor);
    send(res, result);
  };

  disconnect = async (req: Request, res: Response): Promise<void> => {
    const { provider } = parseProviderParam(req.params as Record<string, string>);
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const result = await this.service.disconnectProvider(provider, actor);
    send(res, result);
  };
}
