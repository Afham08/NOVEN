import AsyncStorage from '@react-native-async-storage/async-storage';

import { createThemePreferenceStore } from '@/settings/theme-preference';

/**
 * The appearance preference over the real device storage.
 *
 * The only file in the theme preference's module tree that knows about a native
 * module, exactly as `session-storage.ts` is for the session history. Keeping the
 * adapter here is what lets `theme-preference.ts` stay pure and unit testable
 * under the plain-Node test harness, where AsyncStorage does not exist.
 */
export const themePreferenceStore = createThemePreferenceStore(AsyncStorage);
