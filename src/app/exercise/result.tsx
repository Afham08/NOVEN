import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getExerciseById } from '@/data/exercises';
import {
  formatPaceParamLabel,
  parseConsistencyParam,
  parseDurationParam,
  parseRangeParam,
  parseRepCountParam,
} from '@/exercise/result-params';

export default function ResultScreen() {
  const { id, reps, duration, pace, range, consistency } = useLocalSearchParams<{
    id?: string;
    reps?: string;
    duration?: string;
    pace?: string;
    range?: string;
    consistency?: string;
  }>();
  const router = useRouter();
  const theme = useTheme();
  const exercise = getExerciseById(id);

  // `reps` crosses the navigation boundary as an untrusted string, so it is
  // re-validated here rather than coerced blindly. 0 is a real result; "abc",
  // "-1", "3.7" and "NaN" are not.
  const repCount = parseRepCountParam(reps);

  /**
   * Leaving is one-shot. Without this, a double tap (or an impatient repeat)
   * fires replace() twice, stacking a second /exercise entry and letting the user
   * navigate Back into this result screen again. The ref flips before the
   * navigation call, so re-entrant presses within the same frame are ignored.
   */
  const leavingRef = useRef(false);
  const leave = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    router.replace('/exercise');
  };

  if (!exercise || repCount === null) {
    return (
      <Screen>
        <Header title="Result not available" />
        <Button variant="primary" title="Back" onPress={leave} />
      </Screen>
    );
  }

  const exerciseWord = repCount === 1 ? 'exercise' : 'exercises';

  return (
    <Screen>
      <Header title="Session Complete" />

      {/*
        The completed count is the answer to the only question that matters
        here, so it is the largest thing on the screen. It is sized to match the
        live counter on the session screen (styles.repsValue there, 84px): the
        result of a session should not read as less important than the running
        total led up to it.

        The hero is one accessible element carrying the whole phrase, rather than
        a bare number that a screen reader would announce as just "5".
      */}
      <Card variant="inverse" gap={Spacing.one} style={styles.hero}>
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${repCount} ${exerciseWord} completed`}>
          <Text
            maxFontSizeMultiplier={1.6}
            style={[styles.heroNumber, { color: theme.accent }]}
            // 84px already fills most of a narrow phone; the cap stops a large
            // accessibility text size from pushing a multi-digit count off the
            // card. Labels and values below keep scaling freely.
            >
            {repCount}
          </Text>
          <Text style={[styles.heroLabel, { color: 'rgba(250, 249, 246, 0.78)' }]}>
            {exerciseWord} completed
          </Text>
        </View>
      </Card>

      {/*
        One sentence, and it exists to set expectations rather than to explain
        anything: these are observations from the session, not a judgement about
        the person. Deliberately not a paragraph describing each metric.
      */}
      <Text style={[styles.explainer, { color: theme.textSecondary }]}>
        These results show how your exercise session went.
      </Text>

      {/*
        Plainest and most factual first, most easily misread last, so an older
        reader meets "how long" and "how fast" before the more abstract "how
        even". Every value is still produced by result-params, so a missing or
        malformed one falls back honestly instead of rendering.

        "Knee range" became "Movement range" deliberately: the same observed
        range, described without naming a body part, so the screen reads the same
        way for any exercise.
      */}
      <Card variant="surface" gap={Spacing.four}>
        <InfoRow stacked label="Time" value={parseDurationParam(duration)} />
        <InfoRow stacked label="Movement pace" value={formatPaceParamLabel(pace)} />
        <InfoRow stacked label="Movement range" value={parseRangeParam(range)} />
        <InfoRow
          stacked
          label="Movement consistency"
          value={parseConsistencyParam(consistency)}
        />
      </Card>

      {/* The single, obvious next step. Handled by the same one-shot `leave`. */}
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
    fontSize: 84,
    lineHeight: 90,
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
  explainer: {
    ...Type.body,
    fontSize: 17,
    lineHeight: 26,
  },
});
