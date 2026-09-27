import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing, Type } from '@/constants/theme';
import { getExerciseById } from '@/data/exercises';
import { paramOrFallback, parseRepCountParam } from '@/exercise/result-params';

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

  return (
    <Screen>
      <Header title="Session Complete" />

      <Card variant="inverse" gap={Spacing.one} style={styles.hero}>
        <Text style={[styles.heroNumber, { color: '#F58A5F' }]}>{repCount}</Text>
        <Text style={[styles.heroLabel, { color: 'rgba(250, 249, 246, 0.7)' }]}>
          {repCount === 1 ? 'rep' : 'reps'} completed
        </Text>
      </Card>

      <Card variant="surface" gap={Spacing.three}>
        <InfoRow label="Duration" value={paramOrFallback(duration, '--')} />
        <InfoRow label="Pace" value={paramOrFallback(pace, '--')} />
        <InfoRow label="Knee range" value={paramOrFallback(range, '--')} />
        <InfoRow label="Consistency" value={paramOrFallback(consistency, 'Not enough data')} />
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
    fontSize: 48,
    lineHeight: 56,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  heroLabel: {
    ...Type.label,
    fontSize: 18,
    lineHeight: 26,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});