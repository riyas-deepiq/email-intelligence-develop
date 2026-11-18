import { createContext, useContext, useEffect, useRef } from 'react';

/**
 * True when the surrounding view pane is the one currently on screen.
 *
 * The dashboard shell keeps every visited view mounted and hides the inactive
 * ones with `display: none` (see Dashboard.tsx / .viewPaneHidden). That's
 * deliberate — it preserves scroll position and avoids refetching on every
 * navigation — but it also means a view's local state never resets, so a search
 * term typed before navigating away is still applied on return.
 *
 * Defaults to true so a view rendered outside the shell (tests, a modal, a tab)
 * behaves normally rather than continuously resetting.
 */
export const ViewActiveContext = createContext<boolean>(true);

export function useViewActive(): boolean {
  return useContext(ViewActiveContext);
}

/**
 * Runs `reset` when the view goes from active to hidden.
 *
 * Resetting on hide rather than on re-show means the view is already clean when
 * you come back — no flash of stale filtered results before the effect fires.
 *
 * Intended for transient state: search terms, filters, row selection, current
 * page. `reset` is held in a ref, so an inline arrow is fine and won't cause
 * the effect to re-run every render.
 */
export function useResetOnHide(reset: () => void): void {
  const active    = useViewActive();
  const wasActive = useRef(active);
  const resetRef  = useRef(reset);
  resetRef.current = reset;

  useEffect(() => {
    if (wasActive.current && !active) resetRef.current();
    wasActive.current = active;
  }, [active]);
}
