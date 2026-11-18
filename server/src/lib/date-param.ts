/** Parse a date query param; "yyyy-mm-dd" for `to` is extended to end of day. */
export function parseDateParam(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value) return undefined;
  const d =
    /^\d{4}-\d{2}-\d{2}$/.test(value) && endOfDay
      ? new Date(`${value}T23:59:59.999`)
      : new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}
