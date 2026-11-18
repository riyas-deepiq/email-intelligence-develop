import type { SyncScheduleConfig } from '../clients/core-server.client';

// Maps Intl's short weekday names to ISO weekday numbers (1=Mon … 7=Sun) —
// the same convention the server uses for org_sync_config.business_days.
// (A previous version used JS getDay() numbering (0=Sun … 6=Sat), which made
// Sunday (ISO 7) unmatchable and collided with Saturday on 6.)
const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/**
 * Returns true when `now`, viewed in the org's timezone, falls on a configured
 * business day within the configured business hours [start, end).
 *
 * Any evaluation problem (unknown timezone, malformed config) is treated as
 * off-hours — the safe default is the slower poll cadence, never a crash.
 */
export function isBusinessHours(cfg: SyncScheduleConfig, now: Date = new Date()): boolean {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
    let hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    if (hour === 24) hour = 0; // some ICU implementations return 24 for midnight

    const dayNum = ISO_WEEKDAY[weekday];
    if (dayNum === undefined || !cfg.businessDays.includes(dayNum)) return false;

    const [startH, startM] = cfg.businessHoursStart.split(':').map(Number);
    const [endH, endM] = cfg.businessHoursEnd.split(':').map(Number);
    const nowMin = hour * 60 + minute;
    const startMin = (startH ?? 9) * 60 + (startM ?? 0);
    const endMin = (endH ?? 18) * 60 + (endM ?? 0);

    return nowMin >= startMin && nowMin < endMin;
  } catch {
    return false;
  }
}

/**
 * Picks the delay until the next job poll: the business-hours interval when
 * inside business hours, the off-hours interval otherwise, and `fallbackMs`
 * when no schedule is available (e.g. server briefly unreachable).
 * Never returns less than 1 second.
 */
export function nextPollDelayMs(
  cfg: SyncScheduleConfig | null | undefined,
  fallbackMs: number,
  now: Date = new Date(),
): number {
  if (!cfg) return Math.max(1000, fallbackMs);
  const intervalMin = isBusinessHours(cfg, now)
    ? cfg.businessHoursIntervalMin
    : cfg.offHoursIntervalMin;
  return Math.max(1000, intervalMin * 60_000);
}
