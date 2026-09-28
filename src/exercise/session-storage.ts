import AsyncStorage from '@react-native-async-storage/async-storage';

import { createSessionStore, type KeyValueStore, type SessionStore } from './session-store';

/**
 * The device-backed key/value store.
 *
 * This is the ONLY file in the app that imports AsyncStorage. Everything about
 * session history — the record shape, the validation, the ordering — lives in
 * `session-store.ts` as pure code, so it is testable without a native runtime and
 * this adapter stays small enough to read at a glance.
 *
 * Isolating the import also matters mechanically: `tsconfig.test.json` compiles
 * only `src/exercise/**` and `tests/**` into the Node test build. Keeping the
 * native import in its own module means the test build never pulls in a native
 * module it cannot load.
 */
const asyncStorageStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

/**
 * The app's session history store, backed by AsyncStorage.
 *
 * Data written here survives app restarts, reinstalls of the JS bundle, and
 * device reboots — it lives in the app's persistent storage directory, not in
 * memory. A single store instance is shared for the app's lifetime, so the
 * history is read from disk once and then served from that cache.
 */
export const sessionStore: SessionStore = createSessionStore(asyncStorageStore);
