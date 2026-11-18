import { Router } from 'express';
import { send } from '../../lib/respond';
import { count, desc, eq, gte, and, isNotNull, lt, sql, inArray } from 'drizzle-orm';
import { getDb } from '../../db/client';
import { withDbRetry } from '../../db/retry';
import { mailboxes, messages, users, ingestionJobs, searchQueries, topics } from '../../db/schema';
import { asyncHandler } from '../../lib/async-handler';
import { logger } from '../../lib/logger';
import { requireAuth, requirePermission, requireRole } from '../../middleware/auth.middleware';
import { createOrgRepository } from '../organizations/org.repository';
import { NotFoundError } from '../../lib/errors';
import {
  collectorHeartbeatService,
  normalizeCollectorInstanceId,
} from '../../services/collector-heartbeat.service';
import { getRagIndexOverview, streamRagPipeline } from '../chat/clients/rag.client';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

const orgRepo = createOrgRepository();

type ChartPeriod = '24h' | '7d' | '30d' | '90d';
const CHART_PERIODS: ChartPeriod[] = ['24h', '7d', '30d', '90d'];
const PERIOD_CONFIG: Record<ChartPeriod, { unit: 'hour' | 'day'; buckets: number }> = {
  '24h': { unit: 'hour', buckets: 24 },
  '7d': { unit: 'day', buckets: 7 },
  '30d': { unit: 'day', buckets: 30 },
  '90d': { unit: 'day', buckets: 90 },
};
const TIME_WINDOWS = [
  { label: 'Morning', startHour: 6, endHour: 12 },
  { label: 'Afternoon', startHour: 12, endHour: 18 },
  { label: 'Evening', startHour: 18, endHour: 24 },
  { label: 'Night', startHour: 0, endHour: 6 },
];

const REPORT_COLORS = [
  '#4f46e5',
  '#0891b2',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#dc2626',
  '#0078d4',
  '#14b8a6',
];

interface DashboardTopicBar {
  name: string;
  count: number;
  color: string;
  trend: number;
}

function percentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function deltaMeta(
  current: number,
  previous: number,
): { delta: string; dir: 'up' | 'down' | 'flat' } {
  const change = percentChange(current, previous);
  return {
    delta: change === 0 ? '' : `${Math.abs(change)}%`,
    dir: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}

function titleFromSlug(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

const TOPIC_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'all',
  'and',
  'are',
  'been',
  'before',
  'call',
  'can',
  'case',
  'com',
  'day',
  'details',
  'email',
  'emails',
  'from',
  'fwd',
  'have',
  'hello',
  'into',
  'mail',
  'meeting',
  'need',
  'new',
  'next',
  'note',
  'please',
  're',
  'reply',
  'request',
  'sent',
  'subject',
  'team',
  'that',
  'the',
  'this',
  'thread',
  'today',
  'update',
  'with',
  'your',
]);

function buildFallbackTopicBars(subjects: Array<string | null | undefined>): DashboardTopicBar[] {
  const counts = new Map<string, number>();

  for (const subject of subjects) {
    const tokens =
      (subject ?? '')
        .toLowerCase()
        .replace(/\b(re|fw|fwd):/g, ' ')
        .match(/[a-z0-9][a-z0-9'-]{2,}/g) ?? [];

    for (const token of tokens) {
      const clean = token.replace(/^'+|'+$/g, '');
      if (clean.length < 4 || /^\d+$/.test(clean) || TOPIC_STOP_WORDS.has(clean)) continue;
      counts.set(clean, (counts.get(clean) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([name, count], i) => ({
      name: titleFromSlug(name),
      count,
      color: REPORT_COLORS[(i + 2) % REPORT_COLORS.length],
      trend: 0,
    }));
}

function parseBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function isoFromDbDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * GET /dashboard/stats?period=24h|7d|30d|90d
 * Aggregate counts and chart data for the admin overview.
 */
dashboardRouter.get(
  '/stats',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const org = await orgRepo.findFirst();
    if (!org) throw new NotFoundError('No organisation configured');

    const requestedPeriod = req.query.period;
    const period: ChartPeriod = CHART_PERIODS.includes(requestedPeriod as ChartPeriod)
      ? (requestedPeriod as ChartPeriod)
      : '30d';
    const { unit, buckets } = PERIOD_CONFIG[period];

    const [
      [{ totalMessages }],
      [{ totalMailboxes }],
      [{ totalUsers }],
      [{ totalWithAttachments }],
    ] = await Promise.all([
      db.select({ totalMessages: count() }).from(messages),
      db.select({ totalMailboxes: count() }).from(mailboxes),
      db
        .select({ totalUsers: count() })
        .from(users)
        .where(and(isNotNull(users.lastLoginAt), eq(users.status, 'active'))),
      db
        .select({ totalWithAttachments: count() })
        .from(messages)
        .where(eq(messages.hasAttachments, true)),
    ]);

    // Emails per bucket (hour for 24h, day otherwise), split by sent vs received.
    const msPerBucket = unit === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - buckets * msPerBucket);
    const truncExpr =
      unit === 'hour'
        ? sql`DATE_TRUNC('hour', received_at AT TIME ZONE 'UTC')`
        : sql`DATE(received_at AT TIME ZONE 'UTC')`;

    const byBucketRows = await db
      .select({
        bucket: truncExpr.as('bucket'),
        cnt: count(),
        sentCnt: sql<number>`COUNT(*) FILTER (WHERE LOWER(${messages.fromAddress}) = LOWER(${mailboxes.address}))`,
      })
      .from(messages)
      .innerJoin(mailboxes, eq(messages.mailboxId, mailboxes.id))
      .where(gte(messages.receivedAt, since))
      .groupBy(truncExpr)
      .orderBy(truncExpr);

    // Fill in zeros for missing buckets to produce a continuous series
    const bucketMap = new Map(
      byBucketRows.map((r) => [r.bucket, { total: Number(r.cnt), sent: Number(r.sentCnt) }]),
    );
    // Bucket timestamps go out as raw ISO — the client formats them into a
    // display label using the viewer's own local timezone (Intl defaults to
    // the browser's zone when none is given), so the same data reads correctly
    // no matter what country the viewer is in. Pre-formatting a label here
    // would bake in one fixed timezone for every viewer.
    const emailsByDay: Array<{ bucket: string; received: number; sent: number }> = [];
    for (let i = buckets - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * msPerBucket);
      const key =
        unit === 'hour'
          ? `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00:00`
          : d.toISOString().slice(0, 10);
      const { total, sent } = bucketMap.get(key) ?? { total: 0, sent: 0 };
      emailsByDay.push({ bucket: d.toISOString(), received: total - sent, sent });
    }

    const timeWindowExpr = sql<string>`
    CASE
      WHEN EXTRACT(HOUR FROM ${messages.receivedAt} AT TIME ZONE 'UTC') >= 0
       AND EXTRACT(HOUR FROM ${messages.receivedAt} AT TIME ZONE 'UTC') < 6 THEN 'Night'
      WHEN EXTRACT(HOUR FROM ${messages.receivedAt} AT TIME ZONE 'UTC') >= 6
       AND EXTRACT(HOUR FROM ${messages.receivedAt} AT TIME ZONE 'UTC') < 12 THEN 'Morning'
      WHEN EXTRACT(HOUR FROM ${messages.receivedAt} AT TIME ZONE 'UTC') >= 12
       AND EXTRACT(HOUR FROM ${messages.receivedAt} AT TIME ZONE 'UTC') < 18 THEN 'Afternoon'
      ELSE 'Evening'
    END
  `;

    const windowRows = await db
      .select({
        window: timeWindowExpr.as('window'),
        cnt: count(),
      })
      .from(messages)
      .where(gte(messages.receivedAt, since))
      .groupBy(timeWindowExpr);

    const windowCounts = new Map(windowRows.map((r) => [r.window, Number(r.cnt)]));
    const windowTotal = Array.from(windowCounts.values()).reduce((sum, value) => sum + value, 0);
    const timeBreakdown = TIME_WINDOWS.map((window) => {
      const itemCount = windowCounts.get(window.label) ?? 0;
      return {
        label: window.label,
        count: itemCount,
        pct: windowTotal > 0 ? Math.round((itemCount / windowTotal) * 100) : 0,
      };
    });

    // Email count per mailbox (for department donut)
    const byMailbox = await db
      .select({
        address: mailboxes.address,
        provider: mailboxes.provider,
        department: mailboxes.departmentName,
        cnt: count(messages.id),
      })
      .from(mailboxes)
      .leftJoin(messages, and(eq(messages.mailboxId, mailboxes.id)))
      .groupBy(mailboxes.id, mailboxes.address, mailboxes.provider, mailboxes.departmentName)
      .orderBy(sql`COUNT(${messages.id}) DESC`);

    send(res, {
      totalMessages: Number(totalMessages),
      totalMailboxes: Number(totalMailboxes),
      totalUsers: Number(totalUsers),
      totalWithAttachments: Number(totalWithAttachments),
      emailsByDay,
      timeBreakdown,
      emailsByMailbox: byMailbox.map((r) => ({
        address: r.address,
        provider: r.provider,
        department: r.department ?? null,
        count: Number(r.cnt),
      })),
    });
  }),
);

/**
 * GET /dashboard/search-history/users?limit=5
 * Latest organisation-wide AI search activity grouped by user.
 */
dashboardRouter.get(
  '/search-history/users',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const org = await withDbRetry(() => orgRepo.findFirst(), {
      operationName: 'search history org lookup',
    });
    if (!org) throw new NotFoundError('No organisation configured');

    const limit = parseBoundedInt(req.query.limit, 5, 1, 25);
    const rows = await withDbRetry(
      () =>
        db.execute(sql`
      SELECT
        sq.user_id,
        u.display_name,
        u.email,
        (
          SELECT m.id
          FROM mailboxes m
          WHERE m.owner_user_id = u.id
            AND m.org_id = ${org.id}
          ORDER BY m.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS mailbox_id,
        COUNT(*)::int AS query_count,
        COUNT(*) FILTER (WHERE sq.success = true)::int AS success_count,
        COUNT(*) FILTER (WHERE sq.success = false)::int AS failed_count,
        COALESCE(ROUND(AVG(sq.response_ms)), 0)::int AS avg_response_ms,
        MAX(sq.created_at) AS latest_at,
        (ARRAY_AGG(sq.query_text ORDER BY sq.created_at DESC))[1] AS latest_query
      FROM search_queries sq
      INNER JOIN "users" u ON u.id = sq.user_id
      WHERE sq.org_id = ${org.id}
        AND sq.user_id IS NOT NULL
      GROUP BY sq.user_id, u.id, u.display_name, u.email
      ORDER BY latest_at DESC
      LIMIT ${limit}
    `),
      { operationName: 'dashboard recent search users' },
    );

    send(res, {
      users: rows.rows.map((row) => {
        const r = row as {
          user_id?: string;
          display_name?: string | null;
          email?: string | null;
          mailbox_id?: string | null;
          query_count?: string | number;
          success_count?: string | number;
          failed_count?: string | number;
          avg_response_ms?: string | number;
          latest_at?: Date | string | null;
          latest_query?: string | null;
        };
        return {
          userId: r.user_id ?? '',
          displayName: r.display_name ?? r.email ?? 'Unknown user',
          email: r.email ?? '',
          mailboxId: r.mailbox_id ?? null,
          queryCount: Number(r.query_count ?? 0),
          successCount: Number(r.success_count ?? 0),
          failedCount: Number(r.failed_count ?? 0),
          avgResponseMs: Number(r.avg_response_ms ?? 0),
          latestAt: isoFromDbDate(r.latest_at),
          latestQuery: r.latest_query ?? '',
        };
      }),
    });
  }),
);

/**
 * GET /dashboard/search-history/users/:userId?limit=5000
 * Search history for a selected user.
 */
dashboardRouter.get(
  '/search-history/users/:userId',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const org = await withDbRetry(() => orgRepo.findFirst(), {
      operationName: 'search history detail org lookup',
    });
    if (!org) throw new NotFoundError('No organisation configured');

    const userId = req.params['userId']!;
    const limit = parseBoundedInt(req.query.limit, 5000, 1, 5000);

    const userRows = await withDbRetry(
      () =>
        db.execute(sql`
      SELECT
        u.id,
        u.display_name,
        u.email,
        (
          SELECT m.id
          FROM mailboxes m
          WHERE m.owner_user_id = u.id
            AND m.org_id = ${org.id}
          ORDER BY m.updated_at DESC NULLS LAST
          LIMIT 1
        ) AS mailbox_id
      FROM "users" u
      WHERE u.id = ${userId}
      LIMIT 1
    `),
      { operationName: 'dashboard search history user lookup' },
    );

    if (userRows.rows.length === 0) throw new NotFoundError('User not found');
    const userRow = userRows.rows[0] as {
      id?: string;
      display_name?: string | null;
      email?: string | null;
      mailbox_id?: string | null;
    };

    const rows = await withDbRetry(
      () =>
        db.execute(sql`
      SELECT id, query_text, intent, response_ms, success, created_at
      FROM search_queries
      WHERE org_id = ${org.id}
        AND user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `),
      { operationName: 'dashboard user search history' },
    );

    send(res, {
      user: {
        userId: userRow.id ?? userId,
        displayName: userRow.display_name ?? userRow.email ?? 'Unknown user',
        email: userRow.email ?? '',
        mailboxId: userRow.mailbox_id ?? null,
      },
      searches: rows.rows.map((row) => {
        const r = row as {
          id?: string;
          query_text?: string;
          intent?: string | null;
          response_ms?: string | number;
          success?: boolean;
          created_at?: Date | string | null;
        };
        return {
          id: r.id ?? '',
          queryText: r.query_text ?? '',
          intent: r.intent ?? 'general',
          responseMs: Number(r.response_ms ?? 0),
          success: Boolean(r.success),
          createdAt: isoFromDbDate(r.created_at),
        };
      }),
    });
  }),
);
/**
 * GET /dashboard/reports?period=24h|7d|30d|90d
 * Aggregated reporting data for the Reports & Analytics page.
 */
dashboardRouter.get(
  '/reports',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const db = getDb();
    const org = await withDbRetry(() => orgRepo.findFirst(), {
      operationName: 'reports org lookup',
    });
    if (!org) throw new NotFoundError('No organisation configured');

    const requestedPeriod = req.query.period;
    const period: ChartPeriod = CHART_PERIODS.includes(requestedPeriod as ChartPeriod)
      ? (requestedPeriod as ChartPeriod)
      : '30d';
    const { unit, buckets } = PERIOD_CONFIG[period];

    const now = Date.now();
    const msPerBucket = unit === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const since = new Date(now - buckets * msPerBucket);
    const previousFrom = new Date(now - buckets * msPerBucket * 2);

    const queryBucketExpr =
      unit === 'hour'
        ? sql<string>`TO_CHAR(DATE_TRUNC('hour', ${searchQueries.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:00:00')`
        : sql<string>`TO_CHAR(DATE_TRUNC('day', ${searchQueries.createdAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

    const queryRows = await withDbRetry(
      () =>
        db
          .select({
            bucket: queryBucketExpr.as('bucket'),
            queries: count(),
            responseMs: sql<number>`COALESCE(ROUND(AVG(${searchQueries.responseMs})), 0)::int`,
          })
          .from(searchQueries)
          .where(and(eq(searchQueries.orgId, org.id), gte(searchQueries.createdAt, since)))
          .groupBy(queryBucketExpr)
          .orderBy(queryBucketExpr),
      { operationName: 'reports query volume' },
    );

    const queryMap = new Map(
      queryRows.map((r) => [
        r.bucket,
        { queries: Number(r.queries), responseMs: Number(r.responseMs) },
      ]),
    );
    const queryVolume: Array<{
      label: string;
      emails: number;
      indexed: number;
      queries: number;
      responseMs: number;
    }> = [];
    for (let i = buckets - 1; i >= 0; i--) {
      const d = new Date(now - i * msPerBucket);
      const key =
        unit === 'hour'
          ? `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, '0')}:00:00`
          : d.toISOString().slice(0, 10);
      const row = queryMap.get(key) ?? { queries: 0, responseMs: 0 };
      queryVolume.push({
        label:
          unit === 'hour'
            ? d.toLocaleTimeString('en', { hour: 'numeric', hour12: true, timeZone: 'UTC' })
            : d.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        emails: 0,
        indexed: 0,
        queries: row.queries,
        responseMs: row.responseMs,
      });
    }

    const [
      [{ currentMessages }],
      [{ previousMessages }],
      [{ currentQueries }],
      [{ previousQueries }],
      [{ avgResponseMs }],
      [{ classifiedMessages }],
    ] = await withDbRetry(
      () =>
        Promise.all([
          db
            .select({ currentMessages: count() })
            .from(messages)
            .where(and(eq(messages.orgId, org.id), gte(messages.receivedAt, since))),
          db
            .select({ previousMessages: count() })
            .from(messages)
            .where(
              and(
                eq(messages.orgId, org.id),
                gte(messages.receivedAt, previousFrom),
                lt(messages.receivedAt, since),
              ),
            ),
          db
            .select({ currentQueries: count() })
            .from(searchQueries)
            .where(and(eq(searchQueries.orgId, org.id), gte(searchQueries.createdAt, since))),
          db
            .select({ previousQueries: count() })
            .from(searchQueries)
            .where(
              and(
                eq(searchQueries.orgId, org.id),
                gte(searchQueries.createdAt, previousFrom),
                lt(searchQueries.createdAt, since),
              ),
            ),
          db
            .select({
              avgResponseMs: sql<number>`COALESCE(ROUND(AVG(${searchQueries.responseMs})), 0)::int`,
            })
            .from(searchQueries)
            .where(and(eq(searchQueries.orgId, org.id), gte(searchQueries.createdAt, since))),
          db
            .select({ classifiedMessages: count() })
            .from(messages)
            .where(
              and(
                eq(messages.orgId, org.id),
                gte(messages.receivedAt, since),
                isNotNull(messages.sentiment),
              ),
            ),
        ]),
      { operationName: 'reports KPI summary' },
    );

    const sentimentRows = await withDbRetry(
      () =>
        db
          .select({
            name: messages.sentiment,
            count: count(),
          })
          .from(messages)
          .where(
            and(
              eq(messages.orgId, org.id),
              gte(messages.receivedAt, since),
              isNotNull(messages.sentiment),
            ),
          )
          .groupBy(messages.sentiment)
          .orderBy(desc(count())),
      { operationName: 'reports sentiment distribution' },
    );

    const sentimentColors: Record<string, string> = {
      positive: '#059669',
      neutral: '#64748b',
      negative: '#dc2626',
    };
    const classifiedTotal = sentimentRows.reduce((sum, r) => sum + Number(r.count), 0);
    const sentimentTotal = Math.max(Number(currentMessages), classifiedTotal);
    const sentiment = sentimentRows.map((r, i) => {
      const name = r.name ?? 'unknown';
      const itemCount = Number(r.count);
      return {
        name: titleFromSlug(name),
        share: sentimentTotal > 0 ? Math.round((itemCount / sentimentTotal) * 1000) / 10 : 0,
        color: sentimentColors[name] ?? REPORT_COLORS[i % REPORT_COLORS.length],
        count: itemCount.toLocaleString(),
      };
    });
    // "Unclassified" is only meaningful as a remainder NEXT TO real buckets.
    // No classification pipeline writes messages.sentiment today, so without the
    // classifiedTotal guard every org gets a single "Unclassified · 100%" slice —
    // a full donut that reads as a real result rather than as "no data". Emitting
    // an empty array instead lets the client fall through to its existing empty
    // state. Once a classifier starts populating messages.sentiment this restores
    // itself automatically; nothing here needs revisiting.
    const unclassifiedCount = Math.max(0, sentimentTotal - classifiedTotal);
    if (classifiedTotal > 0 && unclassifiedCount > 0) {
      sentiment.push({
        name: 'Unclassified',
        share:
          sentimentTotal > 0 ? Math.round((unclassifiedCount / sentimentTotal) * 1000) / 10 : 0,
        color: '#94a3b8',
        count: unclassifiedCount.toLocaleString(),
      });
    }

    const [intentRows, previousIntentRows] = await withDbRetry(
      () =>
        Promise.all([
          db
            .select({
              name: searchQueries.intent,
              count: count(),
            })
            .from(searchQueries)
            .where(
              and(
                eq(searchQueries.orgId, org.id),
                gte(searchQueries.createdAt, since),
                isNotNull(searchQueries.intent),
              ),
            )
            .groupBy(searchQueries.intent)
            .orderBy(desc(count()))
            .limit(8),
          db
            .select({
              name: searchQueries.intent,
              count: count(),
            })
            .from(searchQueries)
            .where(
              and(
                eq(searchQueries.orgId, org.id),
                gte(searchQueries.createdAt, previousFrom),
                lt(searchQueries.createdAt, since),
                isNotNull(searchQueries.intent),
              ),
            )
            .groupBy(searchQueries.intent),
        ]),
      { operationName: 'reports intent breakdown' },
    );

    const previousIntentMap = new Map(previousIntentRows.map((r) => [r.name, Number(r.count)]));
    const intents = intentRows.map((r, i) => {
      const name = r.name ?? 'unknown';
      const itemCount = Number(r.count);
      return {
        name: titleFromSlug(name),
        count: itemCount,
        color: REPORT_COLORS[i % REPORT_COLORS.length],
        trend: percentChange(itemCount, previousIntentMap.get(r.name) ?? 0),
      };
    });

    const topicRows = await withDbRetry(
      () =>
        db
          .select({
            name: topics.name,
            count: topics.messageCount,
          })
          .from(topics)
          .where(eq(topics.orgId, org.id))
          .orderBy(desc(topics.messageCount))
          .limit(8),
      { operationName: 'reports topics' },
    );

    let topicBars = topicRows
      .filter((r) => r.count > 0)
      .map((r, i) => ({
        name: r.name,
        count: Number(r.count),
        color: REPORT_COLORS[(i + 2) % REPORT_COLORS.length],
        trend: 0,
      }));

    if (topicBars.length === 0) {
      const subjectRows = await withDbRetry(
        () =>
          db
            .select({ subject: messages.subject })
            .from(messages)
            .where(and(eq(messages.orgId, org.id), gte(messages.receivedAt, since)))
            .orderBy(desc(messages.receivedAt))
            .limit(1000),
        { operationName: 'reports fallback topics' },
      );
      topicBars = buildFallbackTopicBars(subjectRows.map((r) => r.subject));
    }

    const messageDelta = deltaMeta(Number(currentMessages), Number(previousMessages));
    const queryDelta = deltaMeta(Number(currentQueries), Number(previousQueries));

    const kpis = [
      {
        lab: 'Emails',
        val: Number(currentMessages).toLocaleString(),
        icon: 'mail',
        tone: 'accent',
        ...messageDelta,
      },
      {
        lab: 'Queries',
        val: Number(currentQueries).toLocaleString(),
        icon: 'search',
        tone: 'violet',
        ...queryDelta,
      },
      {
        lab: 'Avg response',
        val: `${Number(avgResponseMs).toLocaleString()}ms`,
        delta: '',
        dir: 'flat' as const,
        icon: 'activity',
        tone: 'teal',
      },
      {
        lab: 'Classified',
        val: Number(classifiedMessages).toLocaleString(),
        delta: '',
        dir: 'flat' as const,
        icon: 'sparkle',
        tone: 'ok',
      },
    ];

    send(res, {
      kpis,
      queryVolume,
      sentiment,
      intents,
      topics: topicBars,
    });
  }),
);

/**
 * GET /dashboard/monitoring
 * Returns real-time data for the monitoring page:
 *  - processingThroughput: emails indexed per day (last 30 days)
 *  - failedIngestion: failed ingestion jobs per day (last 30 days)
 *  - connectorHealth: per-provider aggregated stats
 *  - serviceStatus: server + DB health
 */
dashboardRouter.get(
  '/monitoring',
  requirePermission('monitoring.read'),
  asyncHandler(async (_req, res) => {
    const db = getDb();
    const org = await withDbRetry(() => orgRepo.findFirst(), {
      operationName: 'monitoring org lookup',
    });
    if (!org) throw new NotFoundError('No organisation configured');

    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const indexedDay = sql`DATE(created_at AT TIME ZONE 'UTC')`;

    // Processing throughput: messages indexed per day (last 30 days)
    const throughputRows = await withDbRetry(
      () =>
        db
          .select({ bucket: indexedDay.as('bucket'), cnt: count() })
          .from(messages)
          .where(gte(messages.createdAt, since30d))
          .groupBy(indexedDay)
          .orderBy(indexedDay),
      { operationName: 'monitoring processing throughput' },
    );

    const throughputMap = new Map(throughputRows.map((r) => [String(r.bucket), Number(r.cnt)]));
    const processingThroughput: {
      label: string;
      emails: number;
      indexed: number;
      queries: number;
    }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const indexed = throughputMap.get(key) ?? 0;
      processingThroughput.push({
        label: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        emails: indexed,
        indexed,
        queries: 0,
      });
    }

    // Failed ingestion jobs per day (last 30 days)
    const failedTruncDay = sql`DATE(finished_at AT TIME ZONE 'UTC')`;
    const failedRows = await withDbRetry(
      () =>
        db
          .select({ bucket: failedTruncDay.as('bucket'), cnt: count() })
          .from(ingestionJobs)
          .where(
            and(
              gte(ingestionJobs.createdAt, since30d),
              inArray(ingestionJobs.status, ['failed', 'dead']),
            ),
          )
          .groupBy(failedTruncDay)
          .orderBy(failedTruncDay),
      { operationName: 'monitoring failed ingestion' },
    );

    const failedMap = new Map(failedRows.map((r) => [String(r.bucket), Number(r.cnt)]));
    const failedIngestion: {
      label: string;
      emails: number;
      indexed: number;
      queries: number;
      failed: number;
    }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      const failed = failedMap.get(key) ?? 0;
      failedIngestion.push({
        label: d.toLocaleDateString('en', { month: 'short', day: 'numeric' }),
        emails: 0,
        indexed: 0,
        queries: 0,
        failed,
      });
    }

    // Connector health: per-mailbox rows aggregated by provider in JS
    // (Avoids sum() which returns string | null from Drizzle)
    const mailboxRows = await withDbRetry(
      () =>
        db
          .select({
            provider: mailboxes.provider,
            syncedMessages: mailboxes.syncedMessages,
            syncStatus: mailboxes.syncStatus,
          })
          .from(mailboxes)
          .where(eq(mailboxes.orgId, org.id)),
      { operationName: 'monitoring connector mailboxes' },
    );

    type ProviderAgg = {
      processed: number;
      failed: number;
      queue: number;
      hasError: boolean;
      isSyncing: boolean;
    };
    const providerMap = new Map<string, ProviderAgg>();
    for (const r of mailboxRows) {
      const agg = providerMap.get(r.provider) ?? {
        processed: 0,
        failed: 0,
        queue: 0,
        hasError: false,
        isSyncing: false,
      };
      agg.processed += r.syncedMessages ?? 0;
      if (r.syncStatus === 'error') agg.hasError = true;
      if (r.syncStatus === 'syncing') agg.isSyncing = true;
      providerMap.set(r.provider, agg);
    }

    // Job counts per provider, grouped by status
    const jobRows = await withDbRetry(
      () =>
        db
          .select({
            provider: mailboxes.provider,
            status: ingestionJobs.status,
            cnt: count(),
          })
          .from(ingestionJobs)
          .innerJoin(mailboxes, eq(ingestionJobs.mailboxId, mailboxes.id))
          .where(inArray(ingestionJobs.status, ['pending', 'claimed', 'running', 'failed', 'dead']))
          .groupBy(mailboxes.provider, ingestionJobs.status),
      { operationName: 'monitoring connector job counts' },
    );

    for (const r of jobRows) {
      const agg = providerMap.get(r.provider) ?? {
        processed: 0,
        failed: 0,
        queue: 0,
        hasError: false,
        isSyncing: false,
      };
      if (r.status === 'failed' || r.status === 'dead') agg.failed += Number(r.cnt);
      if (r.status === 'pending' || r.status === 'claimed' || r.status === 'running')
        agg.queue += Number(r.cnt);
      providerMap.set(r.provider, agg);
    }

    const PROVIDER_COLORS: Record<string, string> = {
      m365: '#0078d4',
      google: '#4285F4',
      email_password: '#8b5cf6',
    };

    const connectorHealth = Array.from(providerMap.entries()).map(([provider, agg]) => ({
      name:
        provider === 'm365'
          ? 'Microsoft 365'
          : provider === 'google'
            ? 'Google Workspace'
            : provider,
      color: PROVIDER_COLORS[provider] ?? '#6b7280',
      processed: agg.processed,
      failed: agg.failed,
      queue: agg.queue,
      lag: agg.hasError || agg.isSyncing,
    }));

    // Collector health: merge live poll heartbeats with recent job activity.
    const collectorRows = await withDbRetry(
      () =>
        db.execute(sql`
      SELECT
        claimed_by AS instance_id,
        MAX(COALESCE(updated_at, claimed_at)) AS last_seen,
        COUNT(*) FILTER (WHERE status IN ('claimed','running')) AS jobs_in_flight,
        COUNT(*) FILTER (
          WHERE status = 'done'
            AND COALESCE(finished_at, updated_at) > NOW() - INTERVAL '15 minutes'
        ) AS completed_recently,
        COUNT(*) FILTER (
          WHERE status IN ('failed','dead')
            AND COALESCE(finished_at, updated_at) > NOW() - INTERVAL '15 minutes'
        ) AS failed_recently
      FROM ingestion_jobs
      WHERE claimed_by IS NOT NULL
        AND COALESCE(updated_at, claimed_at) > NOW() - INTERVAL '60 minutes'
      GROUP BY claimed_by
      ORDER BY last_seen DESC
    `),
      { operationName: 'monitoring collector health' },
    );

    type CollectorHealthRecord = {
      instanceId: string;
      lastSeenAt: Date | null;
      jobsInFlight: number;
      completedRecently: number;
      failedRecently: number;
    };

    function coerceDate(value: Date | string | null | undefined): Date | null {
      if (!value) return null;
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isFinite(date.getTime()) ? date : null;
    }

    const collectorMap = new Map<string, CollectorHealthRecord>();
    const upsertCollector = (
      instanceIdRaw: string | null | undefined,
      patch: Partial<Omit<CollectorHealthRecord, 'instanceId'>>,
    ): void => {
      const instanceId = normalizeCollectorInstanceId(instanceIdRaw);
      const existing = collectorMap.get(instanceId) ?? {
        instanceId,
        lastSeenAt: null,
        jobsInFlight: 0,
        completedRecently: 0,
        failedRecently: 0,
      };

      collectorMap.set(instanceId, {
        instanceId,
        lastSeenAt:
          patch.lastSeenAt && (!existing.lastSeenAt || patch.lastSeenAt > existing.lastSeenAt)
            ? patch.lastSeenAt
            : existing.lastSeenAt,
        jobsInFlight: patch.jobsInFlight ?? existing.jobsInFlight,
        completedRecently: patch.completedRecently ?? existing.completedRecently,
        failedRecently: patch.failedRecently ?? existing.failedRecently,
      });
    };

    for (const row of collectorRows.rows) {
      const r = row as {
        instance_id?: string;
        last_seen?: Date | string;
        jobs_in_flight?: string | number;
        completed_recently?: string | number;
        failed_recently?: string | number;
      };
      upsertCollector(r.instance_id, {
        lastSeenAt: coerceDate(r.last_seen),
        jobsInFlight: Number(r.jobs_in_flight ?? 0),
        completedRecently: Number(r.completed_recently ?? 0),
        failedRecently: Number(r.failed_recently ?? 0),
      });
    }

    for (const heartbeat of collectorHeartbeatService.list()) {
      upsertCollector(heartbeat.instanceId, { lastSeenAt: heartbeat.lastSeenAt });
    }

    const collectorHealth = Array.from(collectorMap.values())
      .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0))
      .map((collector) => {
        const ageSec = collector.lastSeenAt
          ? Math.max(0, Math.round((Date.now() - collector.lastSeenAt.getTime()) / 1000))
          : null;
        const status =
          ageSec == null
            ? 'offline'
            : ageSec <= 120
              ? 'healthy'
              : ageSec <= 300
                ? 'idle'
                : 'offline';

        return {
          instanceId: collector.instanceId,
          status,
          lastSeenAt: collector.lastSeenAt?.toISOString() ?? null,
          lastSeenAgeSec: ageSec,
          jobsInFlight: collector.jobsInFlight,
          completedRecently: collector.completedRecently,
          failedRecently: collector.failedRecently,
        };
      });

    // Service status
    const dbStart = Date.now();
    let dbLatency = 0;
    let dbStatus: 'operational' | 'degraded' | 'outage' = 'outage';
    try {
      await withDbRetry(() => db.execute(sql`SELECT 1`), {
        operationName: 'monitoring database health check',
      });
      dbLatency = Date.now() - dbStart;
      dbStatus = dbLatency < 100 ? 'operational' : dbLatency < 500 ? 'degraded' : 'outage';
    } catch (err) {
      dbLatency = Date.now() - dbStart;
      logger.warn({ err }, 'Monitoring database health check failed');
    }

    const uptimeSec = process.uptime();
    const uptimeStr =
      uptimeSec > 86400
        ? `${Math.floor(uptimeSec / 86400)}d ${Math.floor((uptimeSec % 86400) / 3600)}h`
        : uptimeSec > 3600
          ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
          : `${Math.floor(uptimeSec / 60)}m`;

    const serviceStatus = [
      {
        name: 'API Server',
        status: 'operational',
        uptime: uptimeStr,
        latency: `${Math.round(process.cpuUsage().user / 1000)}ms`,
      },
      {
        name: 'Database',
        status: dbStatus,
        uptime: uptimeStr,
        latency: `${dbLatency}ms`,
      },
    ];

    // KPI summary
    const totalIndexed = processingThroughput.reduce((s, r) => s + r.indexed, 0);
    const totalFailed = failedIngestion.reduce((s, r) => s + r.failed, 0);
    const activeJobs = jobRows
      .filter((r) => r.status === 'pending' || r.status === 'claimed' || r.status === 'running')
      .reduce((s, r) => s + Number(r.cnt), 0);

    const kpis = [
      {
        lab: 'Indexed mails (30D)',
        val: totalIndexed.toLocaleString(),
        delta: '',
        dir: 'flat' as const,
        icon: 'gauge',
        tone: 'default',
      },
      {
        lab: 'Failed Jobs',
        val: totalFailed.toLocaleString(),
        delta: '',
        dir: 'flat' as const,
        icon: 'alert',
        tone: totalFailed > 0 ? 'danger' : 'ok',
      },
      {
        lab: 'Active Jobs',
        val: activeJobs.toLocaleString(),
        delta: '',
        dir: 'flat' as const,
        icon: 'activity',
        tone: 'default',
      },
      {
        lab: 'Connectors',
        val: connectorHealth.length,
        delta: '',
        dir: 'flat' as const,
        icon: 'plug',
        tone: 'default',
      },
    ];

    send(res, {
      kpis,
      processingThroughput,
      failedIngestion,
      connectorHealth,
      collectorHealth,
      serviceStatus,
    });
  }),
);

/**
 * GET /dashboard/rag-index
 *
 * Search-index status: how many indexing runs are in flight, how much mail has
 * been made searchable, how fresh it is, and how the pipeline is configured.
 *
 * Kept out of /dashboard/monitoring on purpose. RAG is an optional component
 * that lives in a separate process, so folding it into monitoring would make
 * that page's latency depend on a service many installations do not run. A
 * separate call also lets the interface render "not connected" for this one
 * panel while everything else loads normally.
 */
dashboardRouter.get(
  '/rag-index',
  requirePermission('monitoring.read'),
  asyncHandler(async (_req, res) => {
    const overview = await getRagIndexOverview();

    if (!overview) {
      send(res, {
        connected: false,
        reason: 'The AI search service is not reachable.',
      });
      return;
    }

    send(res, { connected: true, ...overview });
  }),
);

/**
 * GET /dashboard/rag-index/stages
 *
 * Live pipeline stages for the indexing run currently in flight — read →
 * extract → chunk → embed → store, each ticking to "done" as the run moves
 * past it.
 *
 * Superadmin only, and deliberately not merged into /rag-index. This is
 * operational detail about how the product works internally; an ordinary
 * admin watching the monitoring page gets the summary without this detail.
 */
dashboardRouter.get(
  '/rag-index/stages',
  requireRole('superadmin'),
  asyncHandler(async (_req, res) => {
    const overview = await getRagIndexOverview();

    if (!overview) {
      send(res, {
        connected: false,
        activeJobId: null,
        activeJobKind: null,
        jobsActive: 0,
        stages: [],
        log: [],
        elapsedMs: null,
        ocrAvailable: false,
      });
      return;
    }

    send(res, {
      connected: true,
      activeJobId: overview.active_job_id,
      activeJobKind: overview.active_job_kind,
      jobsActive: overview.jobs_active,
      stages: overview.active_stages,
      log: overview.active_log,
      elapsedMs: overview.active_elapsed_ms,
      ocrAvailable: overview.ocr_available,
    });
  }),
);

/**
 * GET /dashboard/rag-index/stages/stream
 *
 * Authenticated SSE proxy for RAG's event-driven pipeline feed. It keeps the
 * service secret on the server and forwards bytes without polling either API.
 */
dashboardRouter.get(
  '/rag-index/stages/stream',
  requireRole('superadmin'),
  asyncHandler(async (_req, res): Promise<void> => {
    const controller = new AbortController();
    const closeUpstream = (): void => controller.abort();
    res.once('close', closeUpstream);

    const upstream = await streamRagPipeline(controller.signal);
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const reader = upstream.body!.getReader();
    try {
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } catch (err) {
      if (!controller.signal.aborted) throw err;
    } finally {
      reader.releaseLock();
      res.off('close', closeUpstream);
      if (!res.writableEnded) res.end();
    }
  }),
);
