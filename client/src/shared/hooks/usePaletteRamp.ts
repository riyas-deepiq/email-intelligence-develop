// =============================================================================
// shared/hooks/usePaletteRamp.ts — palette-aware colour ramp for charts
// =============================================================================
//
// Charts take colours as JS values, so they can't follow CSS palette changes on
// their own. This derives an N-colour monochromatic ramp from the active
// palette's swatch stops, recomputing whenever the palette changes.
//
// It reads from PALETTE_META (not getComputedStyle) on purpose: the palette
// attribute is applied in an effect, so reading computed styles during render
// would see the *previous* palette for a frame. The meta is the race-free
// single source.

import { useMemo } from 'react';
import { useTheme } from '@/app/theme/useTheme';
import { PALETTE_META } from '@/app/theme/palette';

/** `count` chart colours from the active palette's 5-colour set (cycled). */
export function usePaletteRamp(count: number): string[] {
  const { palette } = useTheme();
  return useMemo(() => {
    const colors = PALETTE_META[palette].colors;
    return Array.from({ length: count }, (_, i) => colors[i % colors.length]);
  }, [palette, count]);
}
