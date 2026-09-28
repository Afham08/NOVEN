import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

/**
 * The root stack sits on top of the four primary tabs.
 *
 * Only two kinds of screen live here: the four destinations a person returns to,
 * and the pages that are not activities at all - Settings, and the exercise flow
 * itself. Everything a person can *do* is on the Activities tab, so this stack
 * stays short and the bottom bar never has to grow.
 */
export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
