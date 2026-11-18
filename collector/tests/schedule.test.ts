import { describe, expect, it } from 'vitest';
import { isBusinessHours, nextPollDelayMs } from '../src/scheduling/schedule';
import type { SyncScheduleConfig } from '../src/clients/core-server.client';

function cfg(overrides: Partial<SyncScheduleConfig> = {}): SyncScheduleConfig {
  return {
    timezone: 'UTC',
    businessHoursStart: '09:00',
    businessHoursEnd: '18:00',
    businessDays: [1, 2, 3, 4, 5], // ISO: Mon–Fri
    businessHoursIntervalMin: 5,
    offHoursIntervalMin: 60,
    ...overrides,
  };
}

// Fixed reference dates (UTC):
//   2026-07-06 = Monday, 2026-07-11 = Saturday, 2026-07-12 = Sunday
const MONDAY_10AM = new Date('2026-07-06T10:00:00Z');
const SATURDAY_10AM = new Date('2026-07-11T10:00:00Z');
const SUNDAY_10AM = new Date('2026-07-12T10:00:00Z');

describe('isBusinessHours', () => {
  it('is true on a business day inside business hours', () => {
    expect(isBusinessHours(cfg(), MONDAY_10AM)).toBe(true);
  });

  it('is false on a non-business day', () => {
    expect(isBusinessHours(cfg(), SATURDAY_10AM)).toBe(false);
    expect(isBusinessHours(cfg(), SUNDAY_10AM)).toBe(false);
  });

  // Regression: businessDays uses ISO numbering (1=Mon … 7=Sun). The old
  // implementation used JS getDay() numbering (0=Sun … 6=Sat), which made
  // Sunday (ISO 7) never match a configured Sunday business day.
  it('matches Sunday when the org works Sundays (ISO weekday 7)', () => {
    expect(isBusinessHours(cfg({ businessDays: [7] }), SUNDAY_10AM)).toBe(true);
  });

  it('matches Saturday as ISO weekday 6', () => {
    expect(isBusinessHours(cfg({ businessDays: [6] }), SATURDAY_10AM)).toBe(true);
    expect(isBusinessHours(cfg({ businessDays: [6] }), SUNDAY_10AM)).toBe(false);
  });

  it('treats the start boundary as inside and the end boundary as outside', () => {
    expect(isBusinessHours(cfg(), new Date('2026-07-06T09:00:00Z'))).toBe(true);
    expect(isBusinessHours(cfg(), new Date('2026-07-06T18:00:00Z'))).toBe(false);
    expect(isBusinessHours(cfg(), new Date('2026-07-06T08:59:00Z'))).toBe(false);
  });

  it('evaluates the wall clock in the org timezone, not UTC', () => {
    // Friday 05:00 UTC = Friday 10:30 in Colombo (UTC+5:30) → business hours
    // there, but before 09:00 in UTC.
    const fri5amUtc = new Date('2026-07-10T05:00:00Z');
    expect(isBusinessHours(cfg({ timezone: 'Asia/Colombo' }), fri5amUtc)).toBe(true);
    expect(isBusinessHours(cfg({ timezone: 'UTC' }), fri5amUtc)).toBe(false);
  });

  it('crossing midnight in the org timezone lands on the right weekday', () => {
    // Friday 20:00 UTC = Saturday 01:30 in Colombo → not a Mon–Fri business day.
    const fri8pmUtc = new Date('2026-07-10T20:00:00Z');
    expect(isBusinessHours(cfg({ timezone: 'Asia/Colombo' }), fri8pmUtc)).toBe(false);
  });

  it('falls back to off-hours on an unknown timezone', () => {
    expect(isBusinessHours(cfg({ timezone: 'Not/AZone' }), MONDAY_10AM)).toBe(false);
  });
});

describe('nextPollDelayMs', () => {
  it('uses the business-hours interval inside business hours', () => {
    expect(nextPollDelayMs(cfg(), 30_000, MONDAY_10AM)).toBe(5 * 60_000);
  });

  it('uses the off-hours interval outside business hours', () => {
    expect(nextPollDelayMs(cfg(), 30_000, SUNDAY_10AM)).toBe(60 * 60_000);
  });

  it('uses the fallback when no schedule is available', () => {
    expect(nextPollDelayMs(null, 30_000)).toBe(30_000);
    expect(nextPollDelayMs(undefined, 30_000)).toBe(30_000);
  });

  it('never returns less than one second', () => {
    expect(nextPollDelayMs(null, 0)).toBe(1000);
    expect(nextPollDelayMs(cfg({ businessHoursIntervalMin: 0 }), 30_000, MONDAY_10AM)).toBe(1000);
  });
});
