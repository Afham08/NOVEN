import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { SessionHistory } from '@/components/session/session-history';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing, Type } from '@/constants/theme';
import { describeDifficulty } from '@/data/exercise-format';
import { formatDuration, getExerciseById } from '@/data/exercises';
import { formatConsistencyLabel, formatDurationLabel, formatPaceLabel, formatRangeLabel } from '@/exercise/metrics';
import { isPoseTracked } from '@/exercise/pose-configs';
import type { SessionRecord } from '@/exercise/session-store';
import { sessionStore } from '@/exercise/session-storage';
import { useTheme } from '@/hooks/use-theme';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const exercise = getExerciseById(id);

  /*
   * Whether NOVEN can watch this movement at all is decided by the pose config
   * registry, not by anything written on this screen. An exercise with no config
   * has no camera thresholds, so the screen says so and offers the way to read
   * the steps instead of a Start button that would open a session which could not
   * count anything.
   */
  const tracked = isPoseTracked(id);

  /*
   * Reopening one of this exercise's stored sessions reuses the existing
   * result screen with the same formatter-built params the Progress tab uses,
   * so a session reads the same from either place — and the result screen's
   * own validation re-checks every value on the way in, exactly as it does
   * for a session arriving from the history list.
   */
  const openSession = (record: SessionRecord) => {
    router.push({
      pathname: '/exercise/result',
      params: {
        id: record.exerciseId,
        reps: String(record.reps),
        duration: formatDurationLabel(record.durationSeconds),
        pace: formatPaceLabel(record.paceRpm),
        range: formatRangeLabel(record.rangeMinDeg, record.rangeMaxDeg),
        consistency: formatConsistencyLabel(record.consistencyPct),
      },
    });
  };

  if (!exercise) {
    return (
      <Screen>
        <Header title="Exercise not found" />
        <Button variant="primary" title="Back" onPress={() => router.replace('/exercise')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={exercise.name} />
      <Text style={[styles.meta, { color: theme.text }]}>
        {exercise.target} · {describeDifficulty(exercise.difficulty)} ·{' '}
        {formatDuration(exercise.durationSeconds)}
      </Text>
      <Text style={[styles.description, { color: theme.textSecondary }]}>
        {exercise.description}
      </Text>

      <SectionHeader accent title="How to do it" />
      <Card variant="surface" gap={Spacing.four}>
        {exercise.instructions.map((instruction, index) => (
          <View key={index} style={styles.stepRow}>
            <View style={[styles.stepNumber, { backgroundColor: theme.sageSoft }]}>
              <Text style={[styles.stepNumberText, { color: theme.accentSecondary }]}>
                {index + 1}
              </Text>
            </View>
            <Text style={[styles.stepText, { color: theme.text }]}>{instruction}</Text>
          </View>
        ))}
      </Card>

      <SectionHeader accent title="Safety" />
      <Card variant="tint">
        <Text style={[styles.safetyText, { color: theme.text }]}>{exercise.safetyNote}</Text>
      </Card>

      {/*
        This exercise's own sessions, read from the same store the Progress tab
        reads. The question this screen exists to answer includes "how did this
        go last time?", and the mixed all-activities list cannot answer it from
        here. Rows reopen the stored session through the same result screen a
        live finish uses, and nothing in this section invents a number the
        session did not measure — a session with no pace shows no pace.
      */}
      <SectionHeader accent title="Your sessions" />
      <SessionHistory
        store={sessionStore}
        onOpenSession={openSession}
        exerciseId={exercise.id}
        limit={5}
      />

      {tracked ? (
        <Button
          variant="primary"
          title="Start Exercise"
          onPress={() =>
            router.push({ pathname: '/exercise/session', params: { id: exercise.id } })
          }
        />
      ) : (
        <Card variant="surface" gap={Spacing.two}>
          <Text style={[styles.safetyText, { color: theme.text }]}>
            NOVEN cannot watch this one, so it will not count anything. Read the steps
            above and take your time with them.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: {
    ...Type.label,
    fontSize: 21,
    lineHeight: 28,
    fontWeight: '700',
  },
  description: {
    ...Type.body,
    fontSize: 19,
    lineHeight: 28,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  stepNumber: {
    width: 32,
    height: 32,
    borderRadius: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: {
    ...Type.label,
    fontSize: 18,
    fontWeight: '700',
  },
  stepText: {
    ...Type.body,
    fontSize: 19,
    lineHeight: 28,
    flex: 1,
  },
  safetyText: {
    ...Type.body,
    fontSize: 19,
    lineHeight: 28,
  },
});