export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface AlertEntry {
  id: string;
  severity: AlertSeverity;
  category: string;
  title: string;
  description: string;
  source: string;
  mailboxId: string | null;
  read: boolean;
  createdAt: string;
}

export interface CreateAlertInput {
  orgId: string;
  severity: AlertSeverity;
  category: string;
  title: string;
  description: string;
  source: string;
  mailboxId?: string | null;
}
