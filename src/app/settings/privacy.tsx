import { StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { ComingSoonNote } from '@/components/settings/coming-soon-note';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * There are no privacy controls to reuse, so this page does not offer any. It
 * reports what the app actually does instead, which is checkable against the
 * code and the app configuration:
 *
 *   - Android declares exactly one permission, CAMERA (app.json), and NOVEN asks
 *     for it at the moment a session starts rather than at first launch.
 *   - There is no microphone, location, contacts, or notification permission
 *     declared anywhere.
 *   - Nothing in the app makes a network request, so saved session history stays
 *     in storage on this phone.
 *
 * Deliberately not claimed: encryption, backups, data deletion, or anything
 * about a server. None of that is implemented, and storage here is plain
 * AsyncStorage, so a reassurance about it would be untrue.
 */
export default function PrivacySafetyScreen() {
  const theme = useTheme();

  return (
    <Screen>
      <Header title="Privacy & Safety" />

      <Card gap={Spacing.three}>
        <InfoRow label="Camera" value="Used during an exercise session" stacked />
        <InfoRow label="Microphone" value="Not used" stacked />
        <InfoRow label="Location" value="Not used" stacked />
        <InfoRow label="Your exercise history" value="Saved on this phone" stacked />
        <InfoRow label="NOVEN account" value="Not set up" stacked />
      </Card>

      <Card variant="sage" gap={Spacing.two}>
        <Text style={[styles.explain, { color: theme.text }]}>
          NOVEN asks for camera access only when you start an exercise session,
          and only to watch the movement. Your saved sessions stay on this phone
          and are not sent anywhere.
        </Text>
      </Card>

      {/*
        The paragraph above is deliberately still here. The rows say which
        permissions NOVEN holds, but not when it asks for the camera or what the
        camera is used for, and those are exactly the facts a person is checking
        this screen to find out.
      */}
      <ComingSoonNote title="Changing these settings is not available yet" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  explain: {
    ...Type.body,
  },
});
