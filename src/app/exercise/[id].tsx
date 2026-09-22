import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing, Type } from '@/constants/theme';
import { formatDuration, getExerciseById } from '@/data/exercises';
import { useTheme } from '@/hooks/use-theme';

export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const exercise = getExerciseById(id);

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
        {exercise.target} · {formatDuration(exercise.durationSeconds)}
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

      <Button
        variant="primary"
        title="Start Exercise"
        onPress={() =>
          router.push({ pathname: '/exercise/session', params: { id: exercise.id } })
        }
      />
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