import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing, Type } from '@/constants/theme';
import { getExerciseById } from '@/data/exercises';

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

  if (!exercise || !reps) {
    return (
      <Screen>
        <Header title="Result not available" />
        <Button variant="primary" title="Back" onPress={() => router.replace('/exercise')} />
      </Screen>
    );
  }

  const repCount = Number(reps);

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
        <InfoRow label="Duration" value={duration ?? '--'} />
        <InfoRow label="Pace" value={pace ?? '--'} />
        <InfoRow label="Knee range" value={range ?? '--'} />
        <InfoRow label="Consistency" value={consistency ?? '--'} />
      </Card>

      <Button variant="primary" title="Done" onPress={() => router.replace('/exercise')} />
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