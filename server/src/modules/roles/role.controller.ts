import type { Request, Response } from 'express';
import { send } from '../../lib/respond';
import { actorFromRequest } from '../audit/audit.service';
import type { RoleService } from './role.service';
import { parseAssignUserRoleDto, parseCreateRoleDto, parseUpdateRoleDto } from './role.schema';

export class RoleController {
  constructor(private readonly service: RoleService) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const data = await this.service.listRoles();
    res.status(200).json({ data });
  };

  create = async (req: Request, res: Response): Promise<void> => {
    const dto = parseCreateRoleDto(req.body);
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const role = await this.service.createRole(dto, actor);
    send(res, role, 'OK', 201);
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const dto = parseUpdateRoleDto(req.body);
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const role = await this.service.updateRole(req.params.id, dto, actor);
    send(res, role);
  };

  delete = async (req: Request, res: Response): Promise<void> => {
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    await this.service.deleteRole(req.params.id, actor);
    send(res, { message: 'Role deleted.' });
  };

  assignUser = async (req: Request, res: Response): Promise<void> => {
    const dto = parseAssignUserRoleDto(req.body);
    const actor = req.user ? actorFromRequest(req.user, req.ip) : undefined;
    const user = await this.service.assignUserRole(req.params.userId, dto, actor);
    send(res, user);
  };
}
