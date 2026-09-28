import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ThemePreferenceProvider, useThemePreference } from '@/hooks/use-theme-preference';

SplashScreen.preventAutoHideAsync();

/**
 * The root stack sits on top of the four primary tabs.
 *
 * Only two kinds of screen live here: the four destinations a person returns to,
 * and the pages that are not activities at all - Settings, and the exercise flow
 * itself. Everything a person can *do* is on the Activities tab, so this stack
 * stays short and the bottom bar never has to grow.
 *
 * The appearance preference has to be read above the navigator rather than inside
 * it, because it decides the navigator's own theme. Reading it further down would
 * mean React Navigation chose a palette first and every screen in the app chose
 * another.
 */
export default function RootLayout() {
  return (
    <ThemePreferenceProvider>
      <RootNavigator />
    </ThemePreferenceProvider>
  );
}

function RootNavigator() {
  const colorScheme = useColorScheme();
  const { preference } = useThemePreference();

  /*
   * React Navigation's own theme follows the same three-way decision as
   * `useTheme`: a chosen palette wins, and 'system' defers to the phone. Without
   * this the header and the page beneath it could disagree — a light page under
   * a dark header, or a status bar whose colour fights the content behind it.
   */
  const effectiveScheme = preference === 'system' ? colorScheme : preference;

  return (
    <ThemeProvider value={effectiveScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />

        {/*
          The four activity destinations are stack screens, not tabs, and each
          keeps a titled header. That header is the only visible way back once
          the tab bar is covered, so these screens must not be headerless.
        */}
        <Stack.Screen name="exercise/index" options={{ title: 'Exercise' }} />
        <Stack.Screen name="yoga" options={{ title: 'Yoga' }} />
        <Stack.Screen name="meditation" options={{ title: 'Meditation' }} />
        <Stack.Screen name="wellness" options={{ title: 'Wellness' }} />

        {/*
          One screen runs every guided activity for all three kinds, so there is
          one result screen too rather than three copies of the same summary. The
          header here is the stack's, and each screen draws its own heading inside
          it, exactly as the exercise flow does.
        */}
        <Stack.Screen name="yoga/[id]" options={{ title: 'Routine' }} />
        <Stack.Screen name="meditation/[id]" options={{ title: 'Session' }} />
        <Stack.Screen name="wellness/[id]" options={{ title: 'Activity' }} />
        <Stack.Screen name="activity-result" options={{ title: 'Result' }} />

        {/*
          Settings is not a tab. It is reached from Home and its own sections,
          and each of these returns to Home when the back button is used.
        */}
        <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
        <Stack.Screen name="settings/family" options={{ title: 'Family' }} />
        <Stack.Screen name="settings/language" options={{ title: 'Language' }} />
        <Stack.Screen name="settings/appearance" options={{ title: 'Appearance' }} />
        <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="settings/privacy" options={{ title: 'Privacy & Safety' }} />
        <Stack.Screen name="settings/about" options={{ title: 'About NOVEN' }} />

        {/* The exercise flow, unchanged. */}
        <Stack.Screen name="exercise/[id]" options={{ title: 'Exercise' }} />
        <Stack.Screen name="exercise/session" options={{ title: 'Session' }} />
        <Stack.Screen name="exercise/result" options={{ title: 'Result' }} />
      </Stack>
    </ThemeProvider>
  );
}
