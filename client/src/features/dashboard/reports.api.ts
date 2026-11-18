import { apiClient } from '@/shared/api/client';

export type ReportsPeriod = '24h' | '7d' | '30d' | '90d';

export interface ReportsKpi {
  lab: string;
  val: string | number;
  delta: string;
  dir: 'up' | 'down' | 'flat';
  icon: string;
  tone: string;
}

export interface ReportsVolumePoint {
  label: string;
  emails: number;
  indexed: number;
  queries: number;
  responseMs: number;
}

export interface ReportsSentimentSlice {
  name: string;
  share: number;
  color: string;
  count: string;
}

export interface ReportsBarRow {
  name: string;
  count: number;
  color: string;
  trend: number;
}

export interface ReportsData {
  kpis: ReportsKpi[];
  queryVolume: ReportsVolumePoint[];
  sentiment: ReportsSentimentSlice[];
  intents: ReportsBarRow[];
  topics: ReportsBarRow[];
}

export async function getReportsData(period: ReportsPeriod = '30d'): Promise<ReportsData> {
  const res = await apiClient.get<{ data: ReportsData }>('/dashboard/reports', { params: { period } });
  return res.data.data;
}
