export function normalizeSearchTerm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function stringifySearchValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);

  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

export function matchesSearchTerm(values: unknown[], term: string): boolean {
  const normalizedTerm = normalizeSearchTerm(term);
  if (!normalizedTerm) return true;
  return values.some((value) => stringifySearchValue(value).toLowerCase().includes(normalizedTerm));
}
