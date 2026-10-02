import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { describeLength } from '@/activities/activity-format';
import { findGuidedActivity } from '@/activities/catalog';
import { parseSaveStatusParam, parseSecondsParam, parseStepCountParam, describeSaveStatus } from '@/activities/result-params';
import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The result of a finished Yoga, Meditation or Wellness session.
 *
 * One screen for all three, because what there is to report is the same: how many
 * of the activity's own steps ran, and for how long. What it deliberately does NOT
 * show is the camera session's movement pace, pose range, and steadiness, because
 * a guided session measured none of them. Showing them as "not enough data" three
 * times would be clutter that also implies NOVEN was looking for them.
 *
 * The activity is looked up by id rather than trusted from the params, so the
 * wording and the totals can only come from the catalogue.
 */
export default function ActivityResultScreen() {
  const { id, steps, seconds, how, saved } = useLocalSearchParams<{
    id?: string;
    steps?: string;
    seconds?: string;
    how?: string;
    saved?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();

  const activity = findGuidedActivity(id);
  const stepsCompleted = parseStepCountParam(steps);
  const elapsedSeconds = parseSecondsParam(seconds);

  /**
   * Leaving is once-only, so a double tap cannot stack two of these screens in the
   * stack for the user to navigate back into.
   */
  const leavingRef = useRef(false);
  const leave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    router.replace('/');
  };

  if (activity === undefined || stepsCompleted === null || elapsedSeconds === null) {
    return (
      <Screen>
        <Header title="Result not available" />
        <Button variant="primary" title="Back" onPress={leave} />
      </Screen>
    );
  }

  const totalSteps = activity.steps.length;
  /*
   * Both numbers are clamped to what the activity can possibly be. The params are
   * validated as whole numbers, but "valid number" is not the same as "possible
   * number", and a result that claimed 90 of 5 poses would be absurd rather than
   * merely wrong.
   */
  const done = Math.min(stepsCompleted, totalSteps);
  const runSeconds = Math.min(elapsedSeconds, activity.durationSeconds);
  const ranToTheEnd = done === totalSteps;
  const stopped = how === 'stopped';

  return (
    <Screen>
      {/* A session stopped early is not a completed one, and saying otherwise
          would be the smallest lie on the screen. */}
      <Header title={ranToTheEnd ? 'Finished' : 'Session ended'} />

      <Card variant="inverse" gap={Spacing.one} style={styles.hero}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${done} of ${totalSteps} ${activity.progressNoun} completed`}>
          <Text
            maxFontSizeMultiplier={1.6}
            style={[styles.heroNumber, { color: theme.accent }]}>
            {`${done}/${totalSteps}`}
          </Text>
          <Text style={[styles.heroLabel, { color: 'rgba(250, 249, 246, 0.78)' }]}>
            {activity.progressNoun} completed
          </Text>
        </View>
      </Card>

      <Card variant="surface" gap={Spacing.four}>
        <InfoRow stacked label="Time" value={describeLength(runSeconds)} />
        <InfoRow stacked label="Planned time" value={describeLength(activity.durationSeconds)} />
        {/*
         * Whether the history write landed, not how the session ended. A full
         * routine whose write failed is still an unsaved session, and claiming
         * otherwise here would be the one number on this screen the person has no
         * way to check until the history page contradicts it.
         */}
        <InfoRow
          stacked
          label="Saved to your history"
          value={describeSaveStatus(parseSaveStatusParam(saved), ranToTheEnd, stopped)}
        />
      </Card>

      <Button variant="primary" title="Done" onPress={leave} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
    paddingVertical: Spacing.six,
  },
  heroNumber: {
    ...Type.headingLarge,
    fontSize: 72,
    lineHeight: 80,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  heroLabel: {
    ...Type.label,
    fontSize: 20,
    lineHeight: 28,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
