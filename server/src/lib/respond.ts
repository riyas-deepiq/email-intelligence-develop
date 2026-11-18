// =============================================================================
// lib/respond.ts — standard JSON response envelope
// =============================================================================
//
// One place that defines the success envelope, so every endpoint is consistent.
//
//   sendItem  -> { message, data }                  (single object)
//   sendList  -> { count, message, data }           (array + total)
//   sendPaged -> { count, page, limit, message, data }
//
// All three keep the `data` key, so existing clients that read `res.data.data`
// keep working — the new `count` / `message` fields are additive.

import type { Response } from 'express';

/**
 * Auto-enveloping send: arrays become `{ count, message, data }`, everything
 * else `{ message, data }`. One call covers both list and item endpoints — the
 * count is added only when the payload is actually an array.
 */
export function send<T>(res: Response, data: T, message = 'OK', status = 200): void {
  const body = Array.isArray(data) ? { count: data.length, message, data } : { message, data };
  res.status(status).json(body);
}

/** Single object: `{ message, data }`. */
export function sendItem<T>(res: Response, data: T, message = 'OK', status = 200): void {
  res.status(status).json({ message, data });
}

/** Array with its length as `count`: `{ count, message, data }`. */
export function sendList<T>(res: Response, items: T[], message = 'OK', status = 200): void {
  res.status(status).json({ count: items.length, message, data: items });
}

/** Paged array: `{ count, page, limit, message, data }` — `count` is the grand total. */
export function sendPaged<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  limit: number,
  message = 'OK',
  status = 200,
): void {
  res.status(status).json({ count: total, page, limit, message, data: items });
}
