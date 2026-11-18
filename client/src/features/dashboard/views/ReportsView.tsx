import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { StatCard, CardHead, AreaChart, Donut, BarRows, Icon } from '@/shared/components/ui';
import { usePaletteRamp } from '@/shared/hooks/usePaletteRamp';
import { hasPermission } from '../access';
import { getReportsData, type ReportsData, type ReportsPeriod } from '../reports.api';
import s from '@/styles/features/dashboard/views/views.module.css';

const PERIODS: ReportsPeriod[] = ['24h', '7d', '30d', '90d'];

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadReportsCsv(data: ReportsData, period: ReportsPeriod) {
  const rows: Array<Array<string | number>> = [
    ['section', 'name', 'value', 'extra'],
    ...data.kpis.map((k) => ['kpi', k.lab, k.val, k.delta]),
    ...data.queryVolume.map((p) => ['query_volume', p.label, p.queries, `${p.responseMs}ms`]),
    ...data.sentiment.map((p) => ['sentiment', p.name, p.count, `${p.share}%`]),
    ...data.intents.map((p) => ['intent', p.name, p.count, `${p.trend}%`]),
    ...data.topics.map((p) => ['topic', p.name, p.count, `${p.trend}%`]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `insight-hub-reports-${period}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function ReportsView() {
  const { user } = useAuth();
  const canReadReports = hasPermission(user, 'reports.read');
  const [period, setPeriod] = useState<ReportsPeriod>('30d');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard-reports', period],
    queryFn:  () => getReportsData(period),
    staleTime: 60_000,
  });

  // Recolour the categorical charts (intents, topics) with the active palette.
  // Sentiment keeps its semantic colours (green = positive, etc.).
  const paletteColors = usePaletteRamp(8);
  const paint = <T extends { color: string }>(rows: T[]): T[] =>
    rows.map((r, i) => ({ ...r, color: paletteColors[i % paletteColors.length] }));

  const vol       = data?.queryVolume ?? [];
  const sentiment = data?.sentiment ?? [];
  const intents   = paint(data?.intents ?? []);
  const topics    = paint(data?.topics ?? []);
  const kpis      = data?.kpis ?? [];

  if (isLoading && !data) {
    return (
      <div className={s.page}>
        <div className={s.emptyState} style={{ minHeight: 200 }}>
          <div className={s.emptyIcon}><Icon name="barChart" size={20} /></div>
          Loading reports data...
        </div>
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className={s.page}>
        <div className={s.emptyState} style={{ minHeight: 200, color: 'var(--danger)' }}>
          <div className={s.emptyIcon}><Icon name="alert" size={20} /></div>
          {error instanceof Error ? error.message : 'Failed to load reports data'}
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      {isError && (
        <div className={s.card} style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <div className={s.cardBody} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--danger)' }}>
            <Icon name="alert" size={16} />
            <span>{error instanceof Error ? error.message : 'Failed to refresh reports data'}</span>
          </div>
        </div>
      )}

      <div className={s.pageHead}>
        <div>
          <h2 className={s.pageHeadTitle}>{canReadReports ? 'Organization analytics' : 'My analytics'}</h2>
          <p className={s.pageHeadSub}>Aggregated business intelligence over time</p>
        </div>
        <div className={s.pageHeadRight}>
          <div className={s.chips}>
            {PERIODS.map(p => (
              <button
                key={p}
                className={`${s.chip} ${period === p ? s.chipActive : ''}`}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <button
            className={s.btn}
            disabled={!data}
            onClick={() => data && downloadReportsCsv(data, period)}
          >
            <Icon name="download" size={14} /> Export CSV
          </button>
        </div>
      </div>

      <div className={s.statGrid} style={{ marginBottom: 16 }}>
        {kpis.map((k, i) => <StatCard key={i} d={{ ...k, color: paletteColors[i % 3] }} />)}
      </div>

      <div className={s.colsMain} style={{ marginBottom: 16 }}>
        <div className={s.card}>
          <CardHead
            title="Query volume & retrieval performance"
            sub="Natural-language questions answered per day"
          />
          <div className={s.cardBody}>
            {vol.length > 0 && vol.some((p) => p.queries > 0)
              ? <AreaChart data={vol} keys={['queries']} colors={['var(--accent)']} height={230} />
              : <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="activity" size={20} /></div>No query data yet.</div>
            }
          </div>
        </div>

        <div className={s.card}>
          <CardHead title="Sentiment distribution" sub="Requires message classification" />
          <div className={s.cardBody} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            {sentiment.length > 0 ? (
              <>
                <Donut data={sentiment} size={160} />
                <div className={s.legend} style={{ width: '100%' }}>
                  {sentiment.map((item, i) => (
                    <div key={i} className={s.legendRow}>
                      <span className={s.legendSwatch} style={{ background: item.color }} />
                      <span className={s.t2} style={{ fontSize: 12.5 }}>{item.name}</span>
                      <span className={s.legendVal}>{item.count}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="book" size={20} /></div>Sentiment classification isn’t enabled yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className={s.cols2}>
        <div className={s.card}>
          <CardHead title="Intent breakdown" sub="What people are emailing about" icon="activity" />
          <div className={s.cardBody}>
            {intents.length > 0
              ? <BarRows data={intents} />
              : <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="activity" size={20} /></div>No intent data yet.</div>
            }
          </div>
        </div>
        <div className={s.card}>
          <CardHead title="Knowledge topics" sub="Volume & momentum" icon="book" />
          <div className={s.cardBody}>
            {topics.length > 0
              ? <BarRows data={topics} />
              : <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="book" size={20} /></div>No topics yet.</div>
            }
          </div>
        </div>
      </div>
    </div>
  );
}
