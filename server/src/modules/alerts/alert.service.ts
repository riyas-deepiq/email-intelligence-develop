import { logger } from '../../lib/logger';
import type { AlertRepository } from './alert.repository';
import type { AlertEntry, CreateAlertInput } from './alert.types';

export class AlertService {
  constructor(private readonly repo: AlertRepository) {}

  /** Best-effort — a failed alert write must never break the action that triggered it. */
  async record(input: CreateAlertInput): Promise<void> {
    try {
      await this.repo.create(input);
    } catch (err) {
      logger.warn({ err }, 'Failed to write alert');
    }
  }

  async list(orgId: string): Promise<AlertEntry[]> {
    return this.repo.findAll(orgId);
  }

  async markAllRead(orgId: string): Promise<void> {
    await this.repo.markAllRead(orgId);
  }

  async markRead(id: string, orgId: string): Promise<boolean> {
    return this.repo.markRead(id, orgId);
  }
}
