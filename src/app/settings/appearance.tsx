import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { Spacing, Type } from '@/constants/theme';
import { useThemePreference } from '@/hooks/use-theme-preference';
import { useTheme } from '@/hooks/use-theme';
import type { ThemePreference } from '@/settings/theme-preference';

/**
 * The three themes, in the order they are offered.
 *
 * 'Same as my phone' is first on purpose. It is the default, it is what the app
 * has always done, and somebody who opens Appearance without a particular reason
 * in mind should find the answer they already had rather than a new appearance
 * waiting to be tapped.
 */
const OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Same as my phone' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/**
 * Choosing a theme, and it works.
 *
 * Previously this screen listed three rows and marked two of them "Coming soon",
 * which was true and also left a setting that did nothing. It is now a real
 * choice, stored on the device and applied by `useTheme` to every screen,
 * including the live camera session.
 *
 * There is no explanation on this screen. The rows name themselves, the chosen
 * one says so, and there is no paragraph about what a theme is. Somebody who
 * picked a setting once will not need it explained the next four hundred times.
 */
export default function AppearanceSettingsScreen() {
  const theme = useTheme();
  const { preference, setPreference } = useThemePreference();

  return (
    <Screen>
      <Header title="Appearance" />

      <Card variant="surface" gap={Spacing.two}>
        {OPTIONS.map((option, index) => (
          <View key={option.value}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: theme.border }]} /> : null}
            <Button
              variant="ghost"
              fullWidth
              title={option.label}
              onPress={() => setPreference(option.value)}
              style={styles.row}
              right={
                preference === option.value ? (
                  <Text style={[styles.mark, { color: theme.accent }]}>Selected</Text>
                ) : null
              }
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    justifyContent: 'flex-start',
    gap: Spacing.three,
  },
  divider: {
    height: 1,
    marginVertical: Spacing.two,
  },
  mark: {
    ...Type.label,
    fontSize: 17,
    fontWeight: '700',
  },
});
