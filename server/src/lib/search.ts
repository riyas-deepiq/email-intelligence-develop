export function parseSearchParam(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const search = value.trim();
  return search ? search : undefined;
}
