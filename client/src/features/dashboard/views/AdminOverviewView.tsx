import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getProviderStatus } from '@/features/provider-connection/provider-connection.api';
import { fetchJitConfig } from '@/features/oidc/oidc.api';
import { getDashboardStats, type DashboardChartPeriod } from '@/features/messages/messages.api';
import { queryAuditLog } from '@/features/audit/audit.api';
import { auditEventLabel, auditTargetLabel, auditCategoryTone, AUDIT_CATEGORIES, toneColorVars } from '@/features/audit/audit.labels';
import { ConcentricRingChart, Icon, UserCell } from '@/shared/components/ui';
import { usePaletteRamp } from '@/shared/hooks/usePaletteRamp';
import { View, viewPath } from '../dashboard.types';
import { getReportsData, type ReportsBarRow } from '../reports.api';
import {
  getDashboardSearchUsers,
  getDashboardUserSearchHistory,
  type DashboardSearchUser,
} from '../searchHistory.api';
import s from '@/styles/features/dashboard/views/AdminOverviewView.module.css';
import type { ComponentType, SVGProps } from 'react';
import IcAttachments from '@/assets/icons/attachments.svg?react';
import IcBuilding from '@/assets/icons/building.svg?react';
import IcCheck from '@/assets/icons/check.svg?react';
import IcChevronRight from '@/assets/icons/chevron-right.svg?react';
import IcMail from '@/assets/icons/mail.svg?react';
import IcSearch from '@/assets/icons/search.svg?react';
import IcUsers from '@/assets/icons/users.svg?react';

type DashStat = { lab: string; val: string | number; delta: string; dir: 'up' | 'down' | 'flat'; color: string; grad: readonly [string, string]; iconKey: 'mail' | 'paperclip' | 'users' | 'building'; to: View; };
type ActivityEntry = { who: string; entityType: string; act: string; time: string; timeTitle: string; };


// ── Helpers ───────────────────────────────────────────────────────────────────

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function formatActivityTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatActivityTimeTitle(iso: string): string {
  return new Date(iso).toLocaleString([], {
    year:   'numeric',
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatRecentTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;

  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Now';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  return new Date(iso).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}


function formatHistoryDate(iso: string | null): string {
  if (!iso) return 'Unknown time';
  return new Date(iso).toLocaleString([], {
    month:  'short',
    day:    'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function formatIntentLabel(intent: string): string {
  return intent.replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}
// ── Inline SVG icons ──────────────────────────────────────────────────────────


// ── Icon map for stat cards ───────────────────────────────────────────────────

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>;

const STAT_ICON_MAP: Record<DashStat['iconKey'], SvgIcon> = {
  mail:      IcMail,
  paperclip: IcAttachments,
  users:     IcUsers,
  building:  IcBuilding,
};

type Period = DashboardChartPeriod;
const PERIODS: Period[] = ['24h', '7d', '30d', '90d'];

type DashboardChartPoint = {
  label: string;
  received: number;
  sent: number;
};

type SvgPoint = {
  x: number;
  y: number;
};

function roundedChartMax(value: number): number {
  const padded = Math.max(value, 1) * 1.08;
  const roughStep = padded / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceStep =
    normalized <= 1 ? 1 :
    normalized <= 2 ? 2 :
    normalized <= 2.5 ? 2.5 :
    normalized <= 5 ? 5 :
    10;

  return Math.max(4, niceStep * magnitude * 4);
}

function formatChartTick(value: number): string {
  return value >= 1_000 ? `${Math.round(value / 1_000)}k` : value.toLocaleString();
}

function buildSmoothPath(points: SvgPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;

    const prev = points[index - 1];
    const beforePrev = points[index - 2] ?? prev;
    const next = points[index + 1] ?? point;
    const cp1x = prev.x + (point.x - beforePrev.x) / 6;
    const cp1y = prev.y + (point.y - beforePrev.y) / 6;
    const cp2x = point.x - (next.x - prev.x) / 6;
    const cp2y = point.y - (next.y - prev.y) / 6;

    return `${path} C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, '');
}

function DashboardDeliveryChart({ data, height = 200 }: { data: DashboardChartPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className={s.dashboardChart} style={{ height }}>
        <div className={s.dashboardChartEmpty}>No email activity in this period.</div>
      </div>
    );
  }

  const width = 600;
  const pad = { top: 20, right: 18, bottom: 30, left: 38 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const maxValue = roundedChartMax(Math.max(...data.flatMap((d) => [d.received, d.sent, 1])));
  const ticks = Array.from({ length: 5 }, (_, index) => Math.round((maxValue / 4) * index));
  const labelEvery = Math.max(1, Math.floor(data.length / 6));

  const xFor = (index: number) => (
    data.length === 1
      ? pad.left + plotWidth / 2
      : pad.left + (index / (data.length - 1)) * plotWidth
  );
  const yFor = (value: number) => pad.top + plotHeight * (1 - value / maxValue);

  const receivedPoints = data.map((item, index) => ({ x: xFor(index), y: yFor(item.received) }));
  const sentPoints = data.map((item, index) => ({ x: xFor(index), y: yFor(item.sent) }));
  const hoverX = hover === null ? null : xFor(hover);
  const hoverPercent = hoverX === null ? 50 : (hoverX / width) * 100;
  const tooltipEdgeClass =
    hoverPercent < 18 ? s.dashboardTooltipLeft :
    hoverPercent > 82 ? s.dashboardTooltipRight :
    '';
  const hoverBand = data.length === 1 ? plotWidth : plotWidth / (data.length - 1);

  return (
    <div className={s.dashboardChart} style={{ height }} onMouseLeave={() => setHover(null)}>
      <div className={s.dashboardYAxis}>
        {ticks.map((tick) => (
          <span
            key={tick}
            className={s.dashboardYTick}
            style={{ top: yFor(tick) }}
          >
            {formatChartTick(tick)}
          </span>
        ))}
      </div>

      <svg
        className={s.dashboardChartSvg}
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
      >
        {ticks.map((tick) => (
          <line
            key={tick}
            className={s.dashboardGridLine}
            x1={pad.left}
            x2={width - pad.right}
            y1={yFor(tick)}
            y2={yFor(tick)}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        <path className={s.dashboardChartLineTarget} d={buildSmoothPath(sentPoints)} vectorEffect="non-scaling-stroke" />
        <path className={s.dashboardChartLineAchieved} d={buildSmoothPath(receivedPoints)} vectorEffect="non-scaling-stroke" />

        {hover !== null && hoverX !== null && (
          <>
            <line
              className={s.dashboardHoverLine}
              x1={hoverX}
              x2={hoverX}
              y1={pad.top}
              y2={height - pad.bottom}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              className={s.dashboardHoverDotTarget}
              cx={sentPoints[hover].x}
              cy={sentPoints[hover].y}
              r="4"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              className={s.dashboardHoverDotAchieved}
              cx={receivedPoints[hover].x}
              cy={receivedPoints[hover].y}
              r="4.5"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {data.map((_, index) => {
          const x = Math.max(pad.left, xFor(index) - hoverBand / 2);
          return (
            <rect
              key={index}
              x={x}
              y={0}
              width={Math.min(hoverBand, width - pad.right - x)}
              height={height}
              fill="transparent"
              onMouseEnter={() => setHover(index)}
            />
          );
        })}
      </svg>

      <div className={s.dashboardXAxis}>
        {data.map((item, index) => {
          if (index !== 0 && index !== data.length - 1 && index % labelEvery !== 0) return null;

          const left = data.length === 1 ? 50 : (index / (data.length - 1)) * 100;
          const transform =
            index === 0 ? 'translateX(0)' :
            index === data.length - 1 ? 'translateX(-100%)' :
            'translateX(-50%)';

          return (
            <span key={`${item.label}-${index}`} className={s.dashboardXTick} style={{ left: `${left}%`, transform }}>
              {item.label}
            </span>
          );
        })}
      </div>

      {hover !== null && (
        <div className={`${s.dashboardTooltip} ${tooltipEdgeClass}`} style={{ left: `${hoverPercent}%` }}>
          <div className={s.dashboardTooltipLabel}>{data[hover].label}</div>
          <div className={s.dashboardTooltipRow}>
            <span className={`${s.dashboardTooltipDot} ${s.dashboardTooltipDotAchieved}`} />
            <span>Received</span>
            <strong>{data[hover].received.toLocaleString()}</strong>
          </div>
          <div className={s.dashboardTooltipRow}>
            <span className={`${s.dashboardTooltipDot} ${s.dashboardTooltipDotTarget}`} />
            <span>Sent</span>
            <strong>{data[hover].sent.toLocaleString()}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AdminOverviewView() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('30d');
  const [selectedSearchUser, setSelectedSearchUser] = useState<DashboardSearchUser | null>(null);

  const { data: providerStatus } = useQuery({
    queryKey: ['provider-status'],
    queryFn: getProviderStatus,
    staleTime: 30_000,
  });
  const { data: jitConfig } = useQuery({
    queryKey: ['jit-config'],
    queryFn: fetchJitConfig,
    staleTime: 60_000,
  });
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats', period],
    queryFn:  () => getDashboardStats(period),
    staleTime: 60_000,
  });
  const { data: auditLog } = useQuery({
    queryKey: ['recent-activity'],
    queryFn:  () => queryAuditLog({ limit: 5 }),
    staleTime: 30_000,
  });
  const { data: reportsData } = useQuery({
    queryKey: ['dashboard-overview-reports', period],
    queryFn:  () => getReportsData(period),
    staleTime: 60_000,
    retry:     false,
  });
  const { data: searchUsers } = useQuery({
    queryKey: ['dashboard-search-users'],
    queryFn:  () => getDashboardSearchUsers(5),
    staleTime: 30_000,
    retry:     false,
  });
  const { data: selectedSearchHistory, isLoading: searchHistoryLoading } = useQuery({
    queryKey: ['dashboard-user-search-history', selectedSearchUser?.userId],
    queryFn:  () => getDashboardUserSearchHistory(selectedSearchUser!.userId),
    enabled:  Boolean(selectedSearchUser?.userId),
    staleTime: 30_000,
    retry:     false,
  });

  const ACTIVITIES: ActivityEntry[] = (auditLog?.data ?? []).map((entry) => {
    const target = entry.entityType === 'session' ? null : auditTargetLabel(entry.eventType, entry.oldValue, entry.newValue);
    return {
      who:        entry.actorEmail,
      entityType: entry.entityType,
      act:        [lowerFirst(auditEventLabel(entry.eventType)), target].filter(Boolean).join(' '),
      time:       formatActivityTime(entry.ts),
      timeTitle:  formatActivityTimeTitle(entry.ts),
    };
  });

  const mailboxConnected = providerStatus?.connected ?? false;
  const setupSteps = [
    { label: 'Organisation configured',  done: true              },
    { label: 'Admin account secured',    done: true              },
    { label: 'Email provider connected', done: mailboxConnected  },
    { label: 'Users added',              done: true              },
    { label: 'SSO / JIT configured',     done: jitConfig?.jitEnabled ?? false },
  ];
  const setupDone = setupSteps.filter(st => st.done).length;
  const timeBreakdown = stats?.timeBreakdown ?? [];
  const hasTimeBreakdown = timeBreakdown.some((t) => t.count > 0);
  const hasReportTopics = (reportsData?.topics?.length ?? 0) > 0;
  const TOPICS: ReportsBarRow[] = (hasReportTopics ? reportsData?.topics ?? [] : reportsData?.intents ?? []).slice(0, 5);
  const topicSourceLabel = hasReportTopics ? 'By email classification volume' : 'Most common AI search intents';
  const RECENT_SEARCH_USERS = searchUsers?.users ?? [];
  const selectedUser = selectedSearchHistory?.user ?? selectedSearchUser;
  const selectedSearches = selectedSearchHistory?.searches ?? [];

  const DASH_STATS: DashStat[] = stats ? [
    { lab: 'Total emails',    val: stats.totalMessages.toLocaleString(),        delta: '', dir: 'flat', color: '#6366f1', grad: ['#6366f1', '#8b5cf6'], iconKey: 'mail',      to: View.Emails      },
    { lab: 'Attachments',     val: stats.totalWithAttachments.toLocaleString(), delta: '', dir: 'flat', color: '#06b6d4', grad: ['#06b6d4', '#0284c7'], iconKey: 'paperclip', to: View.Attachments },
    { lab: 'Users',           val: stats.totalUsers.toLocaleString(),           delta: '', dir: 'flat', color: '#10b981', grad: ['#10b981', '#059669'], iconKey: 'users',     to: View.Users       },
    { lab: 'Mailboxes',       val: stats.totalMailboxes.toLocaleString(),       delta: '', dir: 'flat', color: '#f59e0b', grad: ['#f59e0b', '#ea580c'], iconKey: 'building',  to: View.Mailboxes   },
  ] : [];

  // Format each bucket in the viewer's own local timezone — Intl defaults to
  // the browser's zone when none is given, so this reads correctly no matter
  // what country the viewer is in.
  const chartData = (stats?.emailsByDay ?? []).map((d) => ({
    label: period === '24h'
      ? new Date(d.bucket).toLocaleTimeString('en', { hour: 'numeric', hour12: true })
      : new Date(d.bucket).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    received: d.received,
    sent:     d.sent,
  }));

  // Chart colours from the active palette's 5-colour set — the donut slices and
  // the time-window bars both follow the chosen scheme.
  const paletteColors = usePaletteRamp(5);
  const DEPT_DONUT: { name: string; share: number; color: string; }[] = (stats?.emailsByMailbox ?? [])
    .filter(m => m.count > 0)
    .slice(0, 8)
    .map((m, i) => ({
      name:  m.department ?? m.address.split('@')[0],
      share: m.count,
      color: paletteColors[i % paletteColors.length],
    }));

  const totalForDonut = DEPT_DONUT.reduce((s, d) => s + d.share, 0);
  const donutCenter   = totalForDonut > 0
    ? totalForDonut >= 1_000_000
      ? `${(totalForDonut / 1_000_000).toFixed(2)}M`
      : totalForDonut >= 1_000
        ? `${(totalForDonut / 1_000).toFixed(1)}K`
        : String(totalForDonut)
    : '0';

  return (
    <>
      <div className={s.page}>

      {/* ── Stat cards ────────────────────────────────────────────────────────── */}
      <div className={s.statRow}>
        {DASH_STATS.map((stat, i) => {
          const StatIcon = STAT_ICON_MAP[stat.iconKey];
          // Icon badge follows the active palette: a single-hue gradient built
          // from one of the palette's darker shades (cycled), so all four cards
          // stay on-palette instead of the old fixed rainbow.
          const c = paletteColors[i % 3];
          return (
            <button
              key={i}
              type="button"
              className={s.statCard}
              onClick={() => navigate(viewPath(stat.to))}
              title={`View ${stat.lab.toLowerCase()}`}
            >
              <div className={s.statTop}>
                <div
                  className={s.statIconBox}
                  style={{
                    background: `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 62%, #ffffff))`,
                    boxShadow: `0 6px 16px -4px ${c}66`,   // soft coloured glow
                  }}
                >
                  <StatIcon width={17} height={17} />
                </div>
                {/* Arrow cue that the card is a link — replaces the empty delta
                    badge, which never carried a value. */}
                <span className={s.statGo} aria-hidden="true"><IcChevronRight width={13} height={13} /></span>
              </div>
              <div className={s.statValue}>{stat.val}</div>
              <div className={s.statLabel}>{stat.lab}</div>
            </button>
          );
        })}
      </div>

      {/* ── Row 2: Email ingestion chart + Department donut ────────────────────── */}
      <div className={s.row2}>

        {/* Email ingestion & indexing */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <div className={s.cardHeadLeft}>
              <div className={s.cardTitle}>Email Activity</div>
              <div className={s.cardSub}>Total received and sent messages over time</div>
            </div>
            <div className={s.periodTabs}>
              {PERIODS.map(p => (
                <button
                  key={p}
                  className={`${s.periodTab} ${period === p ? s.periodTabActive : ''}`}
                  onClick={() => setPeriod(p)}
                >{p}</button>
              ))}
            </div>
          </div>
          <div className={s.chartArea}>
            <div className={s.chartLegend}>
              <span className={s.chartLegendItem}>
                <span className={`${s.chartLegendDot} ${s.legendDotEmail}`} />
                Received
              </span>
              <span className={s.chartLegendItem}>
                <span className={`${s.chartLegendDot} ${s.legendDotSent}`} />
                Sent
              </span>
            </div>
            <DashboardDeliveryChart data={chartData} height={200} />
          </div>
        </div>

        {/* Emails by department */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <div className={s.cardHeadLeft}>
              <div className={s.cardTitle}>Emails by Department</div>
              <div className={s.cardSub}>Distribution across org units</div>
            </div>
          </div>
          <div className={s.donutCardSection}>
            <ConcentricRingChart data={DEPT_DONUT} size={200} center={donutCenter} />
          </div>
        </div>

      </div>

      {/* ── Row 3: Setup Progress | Volume by Time Window | Top Topics ─────────── */}
      <div className={s.row3}>

        {/* Setup progress */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <div className={s.cardHeadLeft}>
              <div className={s.cardTitle}>Setup Progress</div>
              <div className={s.cardSub}>Platform configuration checklist</div>
            </div>
            <span className={s.setupCountBadge}>{setupDone}/{setupSteps.length}</span>
          </div>
          <div className={s.setupBody}>
            <div className={s.setupProgressBar}>
              <div
                className={s.setupProgressFill}
                style={{ width: `${(setupDone / setupSteps.length) * 100}%` }}
              />
            </div>
            {setupSteps.map((step, i) => (
              <div key={i} className={s.setupStep}>
                <div className={`${s.setupStepCheck} ${step.done ? s.setupStepCheckDone : s.setupStepCheckTodo}`}>
                  {step.done && <IcCheck width={11} height={11} />}
                </div>
                <span className={step.done ? s.setupStepLabel : s.setupStepLabelTodo}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Volume by time window (vertical gradient bars) */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <div className={s.cardHeadLeft}>
              <div className={s.cardTitle}>Volume by Time Window</div>
              <div className={s.cardSub}>Share of email activity</div>
            </div>
          </div>
          <div className={s.volChart}>
            {!stats ? (
              <div className={s.volEmpty}>Loading activity...</div>
            ) : hasTimeBreakdown ? (
              timeBreakdown.map((t, i) => (
                <div key={t.label} className={s.volBarCol} title={`${t.count.toLocaleString()} emails`}>
                  <div className={s.volBarArea}>
                    <div
                      className={s.volBar}
                      style={{
                        height: `${t.pct}%`,
                        background: paletteColors[i % paletteColors.length],
                      }}
                    >
                      <span className={s.volBarVal}>{t.pct}%</span>
                    </div>
                  </div>
                  <div className={s.volLabel}>{t.label}</div>
                </div>
              ))
            ) : (
              <div className={s.volEmpty}>No email activity in this period.</div>
            )}
          </div>
        </div>

        {/* Top knowledge topics */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <div className={s.cardHeadLeft}>
              <div className={s.cardTitle}>Top Knowledge Topics</div>
              <div className={s.cardSub}>{topicSourceLabel}</div>
            </div>
            <button className={s.cardAction} onClick={() => navigate(viewPath(View.Reports))}>
              Reports <IcChevronRight width={11} height={11} />
            </button>
          </div>
          <div className={s.topicList}>
            {TOPICS.length === 0 ? (
              <div className={s.emptyInline}>No topics yet.</div>
            ) : TOPICS.map((t, i) => (
              <div key={i} className={s.topicRow}>
                <span className={s.topicNum}>{i + 1}</span>
                <div className={s.topicDot} style={{ background: paletteColors[i % paletteColors.length] }} />
                <span className={s.topicName}>{t.name}</span>
                <span className={s.topicCount}>{t.count.toLocaleString()}</span>
                <span className={`${s.topicTrend} ${
                  t.trend > 0 ? s.topicTrendUp :
                  t.trend < 0 ? s.topicTrendDown :
                  s.topicTrendFlat
                }`}>
                  {t.trend > 0
                    ? `↑${t.trend}%`
                    : t.trend < 0
                    ? `↓${Math.abs(t.trend)}%`
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* ── Row 4: Recent Searches | Recent Activity ─────────────────────────── */}
      <div className={s.row4}>

        {/* Recent searches */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <div className={s.cardHeadLeft}>
              <div className={s.cardTitle}>Recent Searches</div>
              <div className={s.cardSub}>Latest search users across the organisation</div>
            </div>
            <button className={s.cardAction} onClick={() => navigate(viewPath(View.Reports))}>
              Reports <IcChevronRight width={11} height={11} />
            </button>
          </div>
          <div className={s.searchList}>
            {RECENT_SEARCH_USERS.length === 0 ? (
              <div className={s.emptyInline}>No recent searches.</div>
            ) : RECENT_SEARCH_USERS.map((user) => (
              <button
                key={user.userId}
                type="button"
                className={s.searchRow}
                onClick={() => setSelectedSearchUser(user)}
              >
                <UserCell
                  name={user.displayName}
                  secondary={user.latestQuery || 'No query text recorded'}
                  mailboxId={user.mailboxId ?? undefined}
                  size={30}
                />
                <span className={s.searchCountPill}>{user.queryCount.toLocaleString()}</span>
                <span className={s.searchTime}>{user.latestAt ? formatRecentTime(user.latestAt) : 'Now'}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent activity */}
        <div className={s.card}>
          <div className={s.cardHead}>
            <div className={s.cardHeadLeft}>
              <div className={s.cardTitle}>Recent Activity</div>
              <div className={s.cardSub}>Last actions across the organisation</div>
            </div>
            <button className={s.cardAction} onClick={() => navigate(viewPath(View.Audit))}>
              Audit log <IcChevronRight width={11} height={11} />
            </button>
          </div>
          <div className={s.activityList}>
            {ACTIVITIES.length === 0 ? (
              <div className={s.emptyInline}>No recent activity.</div>
            ) : ACTIVITIES.map((a, i) => {
              const cat = AUDIT_CATEGORIES.find((c) => c.id === a.entityType);
              const { fg, bg } = toneColorVars(auditCategoryTone(a.entityType));
              return (
                <div key={i} className={s.activityRow}>
                  <div className={s.activityAvatar} style={{ background: bg, color: fg }}>
                    <Icon name={cat?.icon ?? 'activity'} size={14} />
                  </div>
                  <div className={s.activityBody}>
                    <div className={s.activityWho}>{a.who}</div>
                    <div className={s.activityAct}>{a.act}</div>
                  </div>
                  <span className={s.activityTime} title={a.timeTitle}>{a.time}</span>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      </div>
      {selectedSearchUser && selectedUser && (
        <div
          className={s.wizardOverlay}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedSearchUser(null);
          }}
        >
          <section className={s.wizardPanel} role="dialog" aria-modal="true" aria-labelledby="searchHistoryTitle">
            <div className={s.wizardHeader}>
              <div>
                <div className={s.wizardEyebrow}>Search history wizard</div>
                <h2 id="searchHistoryTitle" className={s.wizardTitle}>{selectedUser.displayName}</h2>
                <p className={s.wizardSub}>{selectedUser.email || 'No email address'} - {selectedSearches.length.toLocaleString()} searches loaded</p>
              </div>
              <button className={s.wizardClose} type="button" onClick={() => setSelectedSearchUser(null)} aria-label="Close search history">
                <Icon name="x" size={16} />
              </button>
            </div>

            <div className={s.wizardSteps}>
              <div className={`${s.wizardStep} ${s.wizardStepDone}`}><span>1</span>User</div>
              <div className={`${s.wizardStep} ${s.wizardStepActive}`}><span>2</span>History</div>
              <div className={s.wizardStep}><span>3</span>Review</div>
            </div>

            <div className={s.wizardSummaryGrid}>
              <div className={s.wizardSummaryItem}>
                <span>Total searches</span>
                <strong>{selectedSearchUser.queryCount.toLocaleString()}</strong>
              </div>
              <div className={s.wizardSummaryItem}>
                <span>Successful</span>
                <strong>{selectedSearchUser.successCount.toLocaleString()}</strong>
              </div>
              <div className={s.wizardSummaryItem}>
                <span>Avg response</span>
                <strong>{selectedSearchUser.avgResponseMs.toLocaleString()}ms</strong>
              </div>
            </div>

            <div className={s.wizardHistory}>
              {searchHistoryLoading ? (
                <div className={s.emptyInline}>Loading search history...</div>
              ) : selectedSearches.length === 0 ? (
                <div className={s.emptyInline}>No search history found for this user.</div>
              ) : selectedSearches.map((item) => (
                <div key={item.id} className={s.historyRow}>
                  <div className={s.historyIcon}><IcSearch width={12} height={12} /></div>
                  <div className={s.historyBody}>
                    <div className={s.historyQuery}>{item.queryText}</div>
                    <div className={s.historyMeta}>{formatIntentLabel(item.intent)} - {item.responseMs.toLocaleString()}ms - {formatHistoryDate(item.createdAt)}</div>
                  </div>
                  <span className={`${s.historyStatus} ${item.success ? s.historyStatusOk : s.historyStatusFail}`}>
                    {item.success ? 'Success' : 'Failed'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
