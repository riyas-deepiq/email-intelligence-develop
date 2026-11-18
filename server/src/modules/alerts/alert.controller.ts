import type { Request, Response } from 'express';
import { send } from '../../lib/respond';
import { NotFoundError } from '../../lib/errors';
import type { OrgRepository } from '../organizations/org.repository';
import type { AlertService } from './alert.service';

export class AlertController {
  constructor(
    private readonly service: AlertService,
    private readonly orgRepo: OrgRepository,
  ) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');
    const alerts = await this.service.list(org.id);
    send(res, alerts);
  };

  markAllRead = async (_req: Request, res: Response): Promise<void> => {
    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');
    await this.service.markAllRead(org.id);
    send(res, { message: 'All alerts marked as read.' });
  };

  markRead = async (req: Request, res: Response): Promise<void> => {
    const org = await this.orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organization configured yet');
    const found = await this.service.markRead(req.params['id']!, org.id);
    if (!found) throw new NotFoundError('Alert not found');
    send(res, { message: 'Alert marked as read.' });
  };
}
