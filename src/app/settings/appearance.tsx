import { Screen } from '@/components/layout/screen';
import { ComingSoonNote } from '@/components/settings/coming-soon-note';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AppearanceSettingsScreen() {
  /*
   * NOVEN has no theme preference of its own. `useColorScheme` is React
   * Native's own, which reads the device, and `useTheme` maps an unspecified
   * scheme to light. So the true state of this setting today is "whatever the
   * phone says", and reporting that is the only honest option.
   *
   * Choosing a theme would mean introducing a preference that overrides the
   * device and threading it through every screen's colours, including the live
   * session and the result. That is a real change to shared presentation with
   * no safe partial version, so the three options are shown as planned rather
   * than as switches that appear to work.
   */
  const scheme = useColorScheme();
  const showingNow = scheme === 'dark' ? 'Dark' : 'Light';

  return (
    <Screen>
      <Header title="Appearance" />

      <Card gap={Spacing.three}>
        <InfoRow label="Light" value="Coming soon" stacked />
        <InfoRow label="Dark" value="Coming soon" stacked />
        <InfoRow label="System default" value="In use now" emphasize stacked />
      </Card>

      <Card gap={Spacing.three}>
        <InfoRow label="Showing right now" value={showingNow} stacked />
      </Card>

      {/*
        No message. The rows above already name all three options, mark the one
        in use, and say "Coming soon" on the other two, so a paragraph restating
        that NOVEN follows the phone would only repeat what is on screen.
      */}
      <ComingSoonNote title="Choosing a theme is not available yet" />
    </Screen>
  );
}
