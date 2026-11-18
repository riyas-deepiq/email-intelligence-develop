import { apiClient } from '@/shared/api/client';

export interface MonitoringKpi {
  lab:  string;
  val:  string | number;
  delta: string;
  dir:  'up' | 'down' | 'flat';
  icon: string;
  tone: string;
}

export interface VolPoint {
  label:   string;
  emails:  number;
  indexed: number;
  queries: number;
}

export interface FailedPoint extends VolPoint {
  failed: number;
}

export interface ConnectorHealth {
  name:      string;
  color:     string;
  processed: number;
  failed:    number;
  queue:     number;
  lag:       boolean;
}

export interface ServiceHealth {
  name:    string;
  status:  string;
  uptime:  string;
  latency: string;
}

export interface CollectorHealth {
  instanceId:         string;
  status:             'healthy' | 'idle' | 'offline';
  lastSeenAt:         string | null;
  lastSeenAgeSec:     number | null;
  jobsInFlight:       number;
  completedRecently:  number;
  failedRecently:     number;
}

export interface MonitoringData {
  kpis:                MonitoringKpi[];
  processingThroughput: VolPoint[];
  failedIngestion:      FailedPoint[];
  connectorHealth:      ConnectorHealth[];
  collectorHealth:      CollectorHealth[];
  serviceStatus:        ServiceHealth[];
}

export async function getMonitoringData(): Promise<MonitoringData> {
  const res = await apiClient.get<{ data: MonitoringData }>('/dashboard/monitoring');
  return res.data.data;
}
