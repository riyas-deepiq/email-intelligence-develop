import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Theme, ThemeContext, STORAGE_KEY, resolveTheme, readStoredTheme } from './theme';
import { Palette, readStoredPalette, storePalette } from './palette';

type ViewTransitionDocument = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() => resolveTheme(theme));
  const [palette, setPaletteState] = useState<Palette>(readStoredPalette);

  // Last pointer position — used as the origin of the circular reveal so the
  // new theme wipes out from wherever the user clicked the toggle.
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointerdown', onPointer, true);
    return () => window.removeEventListener('pointerdown', onPointer, true);
  }, []);

  // Persist + reflect the resolved scheme on <html>. Also keeps `auto` in sync
  // with the OS. This never animates; the reveal is driven by the togglers below.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, theme);

    const apply = () => {
      const resolved = resolveTheme(theme);
      setResolvedTheme(resolved);
      document.documentElement.setAttribute('data-theme', resolved);
    };
    apply();

    if (theme === Theme.Auto) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', apply);
      return () => mq.removeEventListener('change', apply);
    }
  }, [theme]);

  // Persist palette to localStorage and set data-palette attribute on <html>
  useEffect(() => {
    storePalette(palette);
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette]);

  // Applies a theme with a circular-reveal View Transition (when supported and
  // motion isn't reduced); otherwise switches instantly.
  const applyTheme = useCallback((next: Theme) => {
    const doc = document as ViewTransitionDocument;
    const root = document.documentElement;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!doc.startViewTransition || reduceMotion) {
      setThemeState(next);
      return;
    }

    // Origin + radius (to the farthest corner) so the circle fully covers the viewport.
    const { x, y } = pointer.current;
    const { innerWidth: w, innerHeight: h } = window;
    const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
    root.style.setProperty('--theme-x', `${x}px`);
    root.style.setProperty('--theme-y', `${y}px`);
    root.style.setProperty('--theme-r', `${r}px`);

    // Update the DOM inside the transition callback so the browser captures the
    // NEW theme for the reveal snapshot. data-theme is set explicitly (not left
    // to the effect, whose flush timing we don't want to depend on); flushSync
    // keeps React state in step within the same synchronous commit.
    doc.startViewTransition(() =>
      flushSync(() => {
        setThemeState(next);
        root.setAttribute('data-theme', resolveTheme(next));
      }),
    );
  }, []);

  const setTheme = useCallback((t: Theme) => applyTheme(t), [applyTheme]);

  const toggleTheme = useCallback(() => {
    applyTheme(resolveTheme(theme) === 'dark' ? Theme.Light : Theme.Dark);
  }, [applyTheme, theme]);

  const setPalette = useCallback((p: Palette) => {
    setPaletteState(p);
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, palette, setTheme, toggleTheme, setPalette }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
