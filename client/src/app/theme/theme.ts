import { createContext } from 'react';
import { Palette } from './palette';

export enum Theme {
  Dark = 'dark',
  Light = 'light',
  Auto = 'auto',
}

export const STORAGE_KEY = 'insight-hub-theme';

export interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: 'dark' | 'light';
  palette: Palette;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  setPalette: (p: Palette) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: Theme.Auto,
  resolvedTheme: 'light',
  palette: Palette.Violet,
  setTheme: () => {},
  toggleTheme: () => {},
  setPalette: () => {},
});

export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme === Theme.Auto) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme === Theme.Light ? 'light' : 'dark';
}

export function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('raynex-theme');
  return stored === Theme.Light || stored === Theme.Dark || stored === Theme.Auto
    ? stored
    : Theme.Auto;
}
