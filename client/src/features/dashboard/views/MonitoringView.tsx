import { useEffect, useState } from 'react';
import { StatCard, CardHead, AreaChart, Badge, Icon } from '@/shared/components/ui';
import { usePaletteRamp } from '@/shared/hooks/usePaletteRamp';
import s from '@/styles/features/dashboard/views/views.module.css';
import { getMonitoringData, type MonitoringData } from '../monitoring.api';

function healthTone(status: string) {
  if (status === 'operational') return 'ok';
  if (status === 'degraded')    return 'warn';
  return 'danger';
}

function collectorTone(status: string): 'ok' | 'warn' | 'danger' {
  if (status === 'healthy') return 'ok';
  if (status === 'idle') return 'warn';
  return 'danger';
}

function lastSeenText(ageSec: number | null): string {
  if (ageSec == null) return 'No heartbeat';
  if (ageSec < 60) return `${ageSec}s ago`;
  const mins = Math.floor(ageSec / 60);
  const secs = ageSec % 60;
  return `${mins}m ${secs}s ago`;
}

function collectorName(instanceId: string): string {
  return instanceId.split(':')[0] || instanceId;
}

export function MonitoringView() {
  const [data, setData]       = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Loads once on mount. Auto-refresh was removed — the view is a snapshot;
  // reload the page (or revisit the tab) to get fresh data.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await getMonitoringData();
        if (!cancelled) setData(result);
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : 'Failed to load monitoring data';
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const vol           = data?.processingThroughput ?? [];
  const failedSeries  = data?.failedIngestion ?? [];
  const ingestion     = data?.connectorHealth ?? [];
  const collectors    = data?.collectorHealth ?? [];
  const systemHealth  = data?.serviceStatus ?? [];
  const kpis          = data?.kpis ?? [];
  const paletteColors = usePaletteRamp(5);

  if (loading && !data) {
    return (
      <div className={s.page}>
        <div className={s.emptyState} style={{ minHeight: 200 }}>
          <div className={s.emptyIcon}><Icon name="gauge" size={20} /></div>
          Loading monitoring data…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className={s.page}>
        <div className={s.emptyState} style={{ minHeight: 200, color: 'var(--danger)' }}>
          <div className={s.emptyIcon}><Icon name="alert" size={20} /></div>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      {error && (
        <div className={s.card} style={{ marginBottom: 16, borderColor: 'var(--danger)' }}>
          <div className={s.cardBody} style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--danger)' }}>
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className={s.statGrid}>
        {kpis.map((k, i) => <StatCard key={i} d={{ ...k, color: paletteColors[i % 3] }} />)}
      </div>

      <div className={s.colsMain} style={{ marginBottom: 16 }}>
        <div className={s.card}>
          <CardHead title="Processing throughput" sub="Indexed mails per day, last 30 days" icon="gauge" />
          <div className={s.cardBody}>
            {vol.length > 0 && vol.some((v) => v.indexed > 0)
              ? <AreaChart data={vol} keys={['indexed']} colors={['var(--accent)']} height={220} />
              : <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="gauge" size={20} /></div>No ingestion data yet.</div>
            }
          </div>
        </div>
        <div className={s.card}>
          <CardHead title="Failed ingestion" sub="Errors per day" icon="alert" />
          <div className={s.cardBody}>
            {failedSeries.length > 0 && failedSeries.some((v) => v.failed > 0)
              ? <AreaChart data={failedSeries} keys={['failed']} colors={['var(--danger)']} height={220} />
              : <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="check" size={20} /></div>No failures recorded.</div>
            }
          </div>
        </div>
      </div>

      <div className={s.cols2}>

        <div className={s.card}>
          <CardHead title="Connector health" sub="Per-provider ingestion" icon="plug" />
          <div className={s.tableWrap}>
            <table className={s.tbl}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th className={s.numCol}>Processed</th>
                  <th className={s.numCol}>Failed</th>
                  <th className={s.numCol}>Queue</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {ingestion.length === 0 ? (
                  <tr><td colSpan={5}><div className={s.emptyState}><div className={s.emptyIcon}><Icon name="plug" size={20} /></div>No connectors configured.</div></td></tr>
                ) : ingestion.map((p, i) => (
                  <tr key={i} style={{ cursor: 'default' }}>
                    <td>
                      <div className={s.cellName}>
                        <span className={s.colorDot} style={{ background: p.color }} />
                        <span className={s.subj}>{p.name}</span>
                      </div>
                    </td>
                    <td className={`${s.numCol} ${s.tnum} ${s.t2}`}>{p.processed.toLocaleString()}</td>
                    <td className={s.numCol} style={{
                      fontVariantNumeric: 'tabular-nums',
                      color: p.failed > 0 ? 'var(--danger)' : 'var(--text-2)',
                      fontWeight: p.failed > 0 ? 600 : undefined,
                    }}>
                      {p.failed.toLocaleString()}
                    </td>
                    <td className={`${s.numCol} ${s.tnum} ${s.t2}`}>{p.queue}</td>
                    <td><Badge tone={p.lag ? 'warn' : 'ok'} dot>{p.lag ? 'sync lag' : 'healthy'}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className={s.card}>
          <CardHead title="Service status" sub="Live infrastructure" icon="activity" />
          <div className={s.cardBody} style={{ paddingTop: 8, paddingBottom: 8 }}>
            {systemHealth.length === 0 ? (
              <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="activity" size={20} /></div>No services to display.</div>
            ) : (
              <div className={s.svcList}>
                {systemHealth.map((svc, i) => (
                  <div key={i} className={s.svcRow}>
                    <span className={s.statusDot} style={{ background: `var(--${healthTone(svc.status)})` }} />
                    <div className={s.svcInfo}>
                      <div className={s.svcName}>{svc.name}</div>
                      <div className={`${s.muted} ${s.svcMeta}`}>{svc.status} · {svc.uptime} uptime</div>
                    </div>
                    <span className={s.mono} style={{ fontSize: 11 }}>{svc.latency}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      <div className={s.card} style={{ marginTop: 16 }}>
        <CardHead title="Collector health" sub="Worker heartbeat and current job load" icon="activity" />
        <div className={s.cardBody} style={{ paddingTop: 8, paddingBottom: 8 }}>
          {collectors.length === 0 ? (
            <div className={s.emptyState}><div className={s.emptyIcon}><Icon name="activity" size={20} /></div>No collectors seen in the last hour.</div>
          ) : (
            <div className={s.svcList}>
              {collectors.map((collector) => (
                <div key={collector.instanceId} className={s.svcRow}>
                  <span className={s.statusDot} style={{ background: `var(--${collectorTone(collector.status)})` }} />
                  <div className={s.svcInfo}>
                    <div className={s.svcName}>{collectorName(collector.instanceId)}</div>
                    <div className={`${s.muted} ${s.svcMeta}`}>
                      {lastSeenText(collector.lastSeenAgeSec)} - {collector.jobsInFlight.toLocaleString()} in flight - {collector.completedRecently.toLocaleString()} done
                    </div>
                  </div>
                  <Badge tone={collectorTone(collector.status)} dot>{collector.status}</Badge>
                  {collector.failedRecently > 0 && (
                    <span className={s.mono} style={{ fontSize: 11, color: 'var(--danger)' }}>
                      {collector.failedRecently.toLocaleString()} failed
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
