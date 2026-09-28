// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping, exactly like the rest of `src/exercise` and
// `src/activities`. The AsyncStorage adapter is a separate file for the same
// reason `session-storage.ts` is.
import type { KeyValueStore } from '../exercise/session-store';

/**
 * ============================================================================
 * The appearance preference — which palette NOVEN paints itself with.
 * ============================================================================
 *
 * WHAT THIS STORES
 * One word: 'light', 'dark', or 'system'. That is the entire preference, and it
 * is stored on the device in the same way the session history is — no account, no
 * network, nothing that leaves the phone.
 *
 * WHY IT IS A SEPARATE KEY FROM THE SESSION HISTORY
 * Clearing your history must not reset how the app looks. They are unrelated
 * facts, so they get unrelated keys, and "clear all data" in Privacy touches only
 * the history.
 *
 * WHY 'system' IS THE DEFAULT
 * On a fresh install there is no stored answer, and the honest reading of "no
 * answer" is "whatever the phone is doing" — which is also what the app did
 * before this setting existed. So a first run looks exactly as it always has, and
 * nobody's screen changes because a preference was added.
 *
 * The value is validated on read for the same reason the session history is: the
 * stored blob is as untrusted as a hand-edited file. An unrecognised value falls
 * back to 'system' instead of throwing, so a future version's value cannot brick
 * the app on an older one.
 */

export const THEME_PREFERENCE_KEY = 'noven.appearance.v1';

/** What the user picked. 'system' means "follow the phone". */
export type ThemePreference = 'light' | 'dark' | 'system';

const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** Every option, in the order the settings screen lists them. */
export const THEME_PREFERENCE_OPTIONS: readonly ThemePreference[] = THEME_PREFERENCES;

/** The preference used when nothing is stored, or when what is stored is unusable. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

/** True for a value this app would have written as a preference. */
export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Parses a stored value, falling back to the default rather than throwing. */
export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  return isThemePreference(raw) ? raw : DEFAULT_THEME_PREFERENCE;
}

export type ThemePreferenceStore = {
  /** The stored preference, or 'system' when unset or unreadable. */
  load(): Promise<ThemePreference>;
  /** Stores a preference. Rejects nothing; a failed write leaves the old value. */
  save(preference: ThemePreference): Promise<void>;
  /** Forgets the preference, returning the app to following the phone. */
  clear(): Promise<void>;
};

export function createThemePreferenceStore(store: KeyValueStore): ThemePreferenceStore {
  return {
    async load() {
      try {
        return parseThemePreference(await store.getItem(THEME_PREFERENCE_KEY));
      } catch {
        // Same reasoning as the session history: a storage that cannot be read is
        // "no preference stored", which is a working app rather than a failed one.
        return DEFAULT_THEME_PREFERENCE;
      }
    },

    async save(preference) {
      await store.setItem(THEME_PREFERENCE_KEY, preference);
    },

    async clear() {
      await store.removeItem(THEME_PREFERENCE_KEY);
    },
  };
}
