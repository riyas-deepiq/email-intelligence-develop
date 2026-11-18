/**
 * palette.ts — Color palette definitions.
 * A modern mixed set with Violet as the product default.
 * (a blend of vivid and restrained). Each palette maps to a [data-palette] block
 * in tokens.css (except Sage, which is the :root default).
 */

export enum Palette {
  Sage = 'sage',
  Indigo = 'indigo',
  Violet = 'violet',
  Emerald = 'emerald',
  Teal = 'teal',
  Rose = 'rose',
  Amber = 'amber',
  Slate = 'slate',
}

export const PALETTE_STORAGE_KEY = 'insight-hub-palette';

export interface PaletteMeta {
  label: string;
  description: string;
  /** A 5-colour set, dark → light, shown as the settings preview strip and used
   *  for multi-series charts (donut slices, time-window bars). Static by
   *  necessity — the strip shows every palette at once, but only the active
   *  palette's colours exist as CSS variables. Single source, next to the
   *  palette definition, rather than duplicated in a view. */
  colors: readonly [string, string, string, string, string];
}

export const PALETTE_META: Record<Palette, PaletteMeta> = {
  [Palette.Sage]: {
    label: 'Sage',
    description: 'Muted green — calm, understated',
    colors: ['#2f4a37', '#4d7150', '#86a683', '#b8ccb0', '#e6efe3'],
  },
  [Palette.Indigo]: {
    label: 'Indigo',
    description: 'Blue-violet — confident, modern',
    colors: ['#312e81', '#4f46e5', '#6366f1', '#a5b4fc', '#e0e7ff'],
  },
  [Palette.Violet]: {
    label: 'Violet',
    description: 'Purple — creative, vivid',
    colors: ['#4c1d95', '#7c3aed', '#8b5cf6', '#c4b5fd', '#ede9fe'],
  },
  [Palette.Emerald]: {
    label: 'Emerald',
    description: 'Bright green — fresh, energetic',
    colors: ['#064e3b', '#059669', '#10b981', '#6ee7b7', '#d1fae5'],
  },
  [Palette.Teal]: {
    label: 'Teal',
    description: 'Blue-green — cool, balanced',
    colors: ['#134e4a', '#0d9488', '#14b8a6', '#5eead4', '#ccfbf1'],
  },
  [Palette.Rose]: {
    label: 'Rose',
    description: 'Pink-red — warm, expressive',
    colors: ['#881337', '#e11d48', '#f43f5e', '#fda4af', '#ffe4e6'],
  },
  [Palette.Amber]: {
    label: 'Amber',
    description: 'Warm gold — vibrant, inviting',
    colors: ['#78350f', '#d97706', '#f59e0b', '#fcd34d', '#fef3c7'],
  },
  [Palette.Slate]: {
    label: 'Slate',
    description: 'Cool grey — corporate, restrained',
    colors: ['#1e293b', '#475569', '#64748b', '#cbd5e1', '#e2e8f0'],
  },
};

export function readStoredPalette(): Palette {
  const stored =
    localStorage.getItem(PALETTE_STORAGE_KEY) ?? localStorage.getItem('raynex-palette');
  if (stored && Object.values(Palette).includes(stored as Palette)) {
    return stored as Palette;
  }
  return Palette.Violet;
}

export function storePalette(palette: Palette): void {
  localStorage.setItem(PALETTE_STORAGE_KEY, palette);
}
