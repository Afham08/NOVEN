import { check, suite } from './harness';

import {
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_KEY,
  ThemePreferenceController,
  createThemePreferenceStore,
  isThemePreference,
  parseThemePreference,
  type ThemePreference,
  type ThemePreferenceStore,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
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

  suite('theme preference: successful changes update state and storage', async () => {
    const backing = memoryStore({ [THEME_PREFERENCE_KEY]: 'dark' });
    const controller = new ThemePreferenceController(createThemePreferenceStore(backing));
    await controller.load();

    await controller.setPreference('light');
    check('a successful Light choice updates the visible preference', controller.getSnapshot().preference === 'light');
    check('a successful Light choice is stored', backing.dump()[THEME_PREFERENCE_KEY] === 'light');

    await controller.setPreference('system');
    check('System remains a selectable preference', controller.getSnapshot().preference === 'system');
    check('System is persisted as the phone-following choice', backing.dump()[THEME_PREFERENCE_KEY] === 'system');
  });

  suite('theme preference: a failed save restores the last persisted choice', async () => {
    const backing = memoryStore({ [THEME_PREFERENCE_KEY]: 'dark' });
    const base = createThemePreferenceStore(backing);
    const failingStore: ThemePreferenceStore = {
      load: () => base.load(),
      async save() {
        throw new Error('storage unavailable');
      },
      clear: () => base.clear(),
    };
    const controller = new ThemePreferenceController(failingStore);
    await controller.load();

    const pendingSave = controller.setPreference('light');
    check('the new choice is applied optimistically', controller.getSnapshot().preference === 'light');
    await pendingSave;

    check('a rejected write does not crash the controller', controller.getSnapshot().ready);
    check('a failed write restores the previous valid preference', controller.getSnapshot().preference === 'dark');
    check('the persisted value remains the previous preference', backing.dump()[THEME_PREFERENCE_KEY] === 'dark');
  });

  suite('theme preference: a selection made during initial loading wins over stale storage', async () => {
    for (const selected of ['light', 'dark', 'system'] as const) {
      const initialStored: ThemePreference = selected === 'dark' ? 'light' : 'dark';
      const loading = deferred<ThemePreference>();
      const writeStarted = deferred<ThemePreference>();
      const writeGate = deferred<void>();
      let persisted: ThemePreference = initialStored;
      const delayedStore: ThemePreferenceStore = {
        load: () => loading.promise,
        async save(next) {
          writeStarted.resolve(next);
          await writeGate.promise;
          persisted = next;
        },
        async clear() {
          persisted = 'system';
        },
      };
      const controller = new ThemePreferenceController(delayedStore);
      const initialLoad = controller.load();
      const pendingSave = controller.setPreference(selected);
      check(`${selected} is visible immediately while loading`, controller.getSnapshot().preference === selected);

      loading.resolve(initialStored);
      await initialLoad;
      const writeValue = await writeStarted.promise;
      check(`${selected} is not overwritten by the stale initial read`, controller.getSnapshot().preference === selected);
      check(`${selected} is the value queued for persistence`, writeValue === selected);

      writeGate.resolve(undefined);
      await pendingSave;
      check(`${selected} remains visible after persistence`, controller.getSnapshot().preference === selected);
      check(`${selected} is the final persisted value`, persisted === selected);
    }
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
