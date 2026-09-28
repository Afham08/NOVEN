import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing, Type } from '@/constants/theme';
import { sessionStore } from '@/exercise/session-storage';
import { useTheme } from '@/hooks/use-theme';

/**
 * What NOVEN stores, and a way to delete it.
 *
 * The permission list above is checkable against the code and the app
 * configuration:
 *
 *   - Android declares exactly one permission, CAMERA (app.json), and NOVEN asks
 *     for it at the moment a session starts rather than at first launch.
 *   - There is no microphone, location, contacts, or notification permission
 *     declared anywhere.
 *   - Nothing in the app makes a network request, so saved sessions stay in
 *     storage on this phone.
 *
 * The second half of a privacy screen is the part that is usually missing: being
 * told data is local is only reassuring to somebody who can delete it. So this
 * screen offers the deletion, and it is a real one — the session history key is
 * actually removed from storage, and the Progress tab then has nothing to plot,
 * which is exactly what "deleted" should mean.
 *
 * WHAT IS NOT CLAIMED
 * Encryption, backups, or anything about a server. None of that is implemented,
 * and storage here is plain AsyncStorage, so a reassurance about it would be
 * untrue. What IS true is that the data is on this device and this button
 * removes it.
 */
export default function PrivacySafetyScreen() {
  const theme = useTheme();
  const router = useRouter();

  const [count, setCount] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);

  /**
   * The real number of stored sessions, so the button describes what is actually
   * there. Null until read, and the destructive control stays unavailable until
   * then — a delete button that appears before it knows what it will delete is a
   * button that can be tapped by somebody who cannot read the question.
   */
  useEffect(() => {
    let active = true;
    void sessionStore.getSessions().then((records) => {
      if (active) setCount(records.length);
    });
    return () => {
      active = false;
    };
  }, []);

  const clear = useCallback(() => {
    if (clearing) return;
    setClearing(true);
    void sessionStore
      .clearSessions()
      .then(() => {
        setCount(0);
        /*
         * Progress reads from the same store, and the tab below has no way to be
         * told a write happened. Going back to it after a deletion is what makes
         * the deletion visible, rather than leaving a chart full of sessions
         * that no longer exist until the app is next opened.
         */
        router.push('/progress');
      })
      .catch(() => setClearing(false));
  }, [clearing, router]);

  return (
    <Screen>
      <Header title="Privacy & Safety" />

      <Card gap={Spacing.three}>
        <InfoRow label="Camera" value="Used during an exercise session" stacked />
        <InfoRow label="Microphone" value="Not used" stacked />
        <InfoRow label="Location" value="Not used" stacked />
        <InfoRow label="Your saved sessions" value="Saved on this phone" stacked />
        <InfoRow label="NOVEN account" value="Not set up" stacked />
      </Card>

      {/*
        The paragraph is deliberately still here. The rows say which permissions
        NOVEN holds, but not when it asks for the camera or what the camera is
        used for, and those are exactly the facts a person is checking this
        screen to find out.
      */}
      <Card variant="sage" gap={Spacing.two}>
        <Text style={[styles.explain, { color: theme.text }]}>
          NOVEN asks for camera access only when you start an exercise session,
          and only to watch the movement. Your saved sessions stay on this phone
          and are not sent anywhere.
        </Text>
      </Card>

      <SectionHeader accent title="Delete everything" />
      <Card variant="surface" gap={Spacing.three}>
        <InfoRow
          stacked
          label="Saved sessions on this phone"
          value={
            count === null
              ? 'Counting…'
              : count === 0
                ? 'None saved'
                : `${count} saved`
          }
        />
        <Button
          variant="outline"
          title="Delete all saved sessions"
          loading={clearing}
          disabled={count === null || count === 0}
          onPress={clear}
        />
        {/*
          Named, not generic. "Delete everything" on a screen that also holds
          permissions would be an overclaim — the camera permission stays granted
          to the app, and noven's appearance preference stays, because neither is
          session data. This deletes the history and says so.
        */}
        <Text style={[styles.footnote, { color: theme.textSecondary }]}>
          This removes the sessions on this phone. It cannot be undone.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  explain: {
    ...Type.body,
  },
  footnote: {
    ...Type.small,
    fontSize: 16,
    lineHeight: 22,
  },
});
