import { check, suite } from './harness';

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_KEY,
  createThemePreferenceStore,
  isThemePreference,
  parseThemePreference,
  type ThemePreference,
} from '../src/settings/theme-preference';
import type { KeyValueStore } from '../src/exercise/session-store';

/** An in-memory stand-in for AsyncStorage, so the store is exercised for real. */
function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { dump(): Record<string, string> } {
  const data: Record<string, string> = { ...seed };
  return {
    async getItem(key) {
      return key in data ? data[key] : null;
    },
    async setItem(key, value) {
      data[key] = value;
    },
    async removeItem(key) {
      delete data[key];
    },
    dump() {
      return { ...data };
    },
  };
}

export function run(): void {
  suite('theme preference: a value from storage is either one of ours or ignored', () => {
    check('light is a preference', isThemePreference('light'));
    check('dark is a preference', isThemePreference('dark'));
    check('system is a preference', isThemePreference('system'));
    check('a name is not a preference', !isThemePreference('sepia'));
    check('an empty value is not a preference', !isThemePreference(''));
    check('a number is not a preference', !isThemePreference(1));
    check('nothing stored means follow the phone', parseThemePreference(null) === 'system');
    check('an unreadable value means follow the phone, not a crash', parseThemePreference('neon') === 'system', parseThemePreference('neon'));
    check('the default follows the phone', DEFAULT_THEME_PREFERENCE === 'system');
  });

  suite('theme preference: an empty install behaves exactly as before', async () => {
    /*
     * This is the upgrade path that matters. Someone who had NOVEN before
     * Appearance existed has no stored value, and must not have their screen
     * change because a setting was added to the app.
     */
    const store = createThemePreferenceStore(memoryStore());
    check('an empty store reports the default', (await store.load()) === 'system');
  });

  suite('theme preference: a chosen theme survives a restart', async () => {
    const backing = memoryStore();
    const store = createThemePreferenceStore(backing);

    await store.save('dark');
    check('it reads back dark', (await store.load()) === 'dark');
    check('it was written under the app key', backing.dump()[THEME_PREFERENCE_KEY] === 'dark');

    // A restart is a brand new store over the same storage. If it comes back as
    // 'system' the user silently lost their choice, which is the failure this
    // test exists to catch.
    const afterRestart = createThemePreferenceStore(backing);
    check('a new store over the same storage still reads dark', (await afterRestart.load()) === 'dark');

    await store.save('light');
    check('a second choice replaces the first', (await afterRestart.load()) === 'light');
  });

  suite('theme preference: a corrupt or hand-edited value is not trusted', async () => {
    const store = createThemePreferenceStore(memoryStore({ [THEME_PREFERENCE_KEY]: 'chartreuse' }));
    check('an unknown value falls back to the phone setting', (await store.load()) === 'system');
  });

  suite('theme preference: storage that cannot be read does not break the app', async () => {
    /*
     * A storage that throws is the one failure mode that would otherwise take
     * the whole app down on launch, because the theme is read above the navigator
     * and every screen depends on it. It has to degrade to a working app.
     */
    const broken: KeyValueStore = {
      async getItem() {
        throw new Error('storage unavailable');
      },
      async setItem() {
        throw new Error('storage unavailable');
      },
      async removeItem() {
        throw new Error('storage unavailable');
      },
    };
    const store = createThemePreferenceStore(broken);
    check('an unreadable store still reports a usable preference', (await store.load()) === 'system');
  });

  suite('theme preference: forgetting it returns the app to the phone setting', async () => {
    const backing = memoryStore();
    const store = createThemePreferenceStore(backing);
    await store.save('dark');
    await store.clear();
    check('the key is gone', backing.dump()[THEME_PREFERENCE_KEY] === undefined);
    check('it reads as following the phone again', (await store.load()) === 'system');
  });

  suite('theme preference: clearing your sessions does not change how the app looks', async () => {
    /*
     * The two live under different keys on purpose. A user who deletes their
     * session history from Privacy is asking about their sessions, not about
     * resetting the app, and silently repainting their screen would be a
     * surprise on a screen whose entire subject is their data.
     */
    const backing = memoryStore();
    const store = createThemePreferenceStore(backing);
    await store.save('dark' as ThemePreference);
    const sessionKey = 'noven.session-history.v1';
    await backing.setItem(sessionKey, '[]');
    await backing.removeItem(sessionKey);
    check('the appearance choice is untouched by removing session data', (await store.load()) === 'dark');
  });
}
