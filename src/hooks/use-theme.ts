/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemePreference } from '@/hooks/use-theme-preference';

/**
 * The colours for the current screen.
 *
 * THREE-WAY RESOLUTION
 * A stored preference of 'light' or 'dark' wins outright. 'system' — the
 * default, and the answer on any install where nobody has touched Appearance —
 * defers to the phone.
 *
 * Reading the preference here rather than in each screen is what makes the
 * setting work everywhere at once: every screen already called this function, so
 * the preference reaches all of them by changing one place, with no screen
 * rewritten and no colour prop threaded through the tree.
 */
export function useTheme() {
  const { preference } = useThemePreference();
  const deviceScheme = useColorScheme();

  if (preference === 'light') return Colors.light;
  if (preference === 'dark') return Colors.dark;

  // 'system', or the 'unspecified' React Native reports before it has asked the
  // device. Unspecified maps to light, which is NOVEN's existing behaviour.
  return Colors[deviceScheme === 'dark' ? 'dark' : 'light'];
}
