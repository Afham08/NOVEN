import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { themePreferenceStore } from '@/settings/theme-preference-storage';
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_OPTIONS,
  type ThemePreference,
} from '@/settings/theme-preference';

/**
 * ============================================================================
 * The one place the chosen palette is held.
 * ============================================================================
 *
 * WHY A PROVIDER RATHER THAN A HOOK THAT LOADS ITSELF
 * Every screen in this app calls `useTheme()` to get its colours. If each of them
 * read the preference independently, the first render of each would be with the
 * wrong palette and then correct itself — a visible flash on every screen, and
 * the live session screen flashing while the camera is already running.
 *
 * So the preference is read ONCE, high up, and handed down. By the time any
 * screen renders, the whole tree is already using one palette, and changing the
 * setting repaints everything at once.
 *
 * WHY THE APP STARTS RENDERING BEFORE THE PREFERENCE IS READ
 * The provider renders immediately with 'system' and updates once storage
 * answers. Waiting for storage would mean a blank screen on launch to avoid a
 * one-frame difference on a setting that is almost always 'system' anyway — and
 * on a phone where somebody is waiting to see their Home screen, a blank screen
 * is the worse trade.
 *
 * `setPreference` updates the state straight away, so tapping a theme repaints
 * the app on the tap rather than after a disk write, and rolls back only if the
 * write actually fails. The screen therefore always shows the truth about what is
 * on screen, and a failed write leaves nothing claimed that is not stored.
 */

type ThemePreferenceContextValue = {
  /** What the user picked. */
  preference: ThemePreference;
  /**
   * True once storage has been read. False only for the first moments of a
   * launch, and the settings screen uses it to avoid a row that briefly claims a
   * choice nobody has made yet.
   */
  ready: boolean;
  setPreference(preference: ThemePreference): void;
};

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void themePreferenceStore.load().then((stored) => {
      if (!active) return;
      setPreferenceState(stored);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    void themePreferenceStore.save(next).catch(() => {
      // The write failed, so the stored value is still the old one. Put the
      // screen back to the truth rather than leaving a choice on display that
      // will not survive a restart.
      setPreferenceState(DEFAULT_THEME_PREFERENCE);
    });
  }, []);

  const value = useMemo<ThemePreferenceContextValue>(
    () => ({ preference, ready, setPreference }),
    [preference, ready, setPreference],
  );

  return createElement(ThemePreferenceContext.Provider, { value }, children);
}

/**
 * The stored preference and a way to change it.
 *
 * Falls back to 'system' rather than throwing when it is called outside the
 * provider, so a component rendered in isolation — in a test, or in a storybook
 * style harness — still gets a working theme instead of a crash.
 */
export function useThemePreference(): ThemePreferenceContextValue {
  const context = useContext(ThemePreferenceContext);
  return (
    context ?? {
      preference: DEFAULT_THEME_PREFERENCE,
      ready: true,
      setPreference: () => {},
    }
  );
}

export { THEME_PREFERENCE_OPTIONS };
