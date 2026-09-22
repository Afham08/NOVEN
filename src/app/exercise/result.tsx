import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { ScoreCard } from '@/components/cards/score-card';
import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { StatusChip } from '@/components/ui/status-chip';
import { Spacing, Type } from '@/constants/theme';
import { getExerciseById } from '@/data/exercises';
import { useTheme } from '@/hooks/use-theme';
import {
  createMockAnalysisResult,
  getPatientFacingMetrics,
  MOCK_ANALYSIS_DELAY_MS,
} from '@/services/analysis';
import { saveSession } from '@/services/saved-sessions';

type ResultPhase = 'analyzing' | 'result';

export default function ResultScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const theme = useTheme();
  const exercise = getExerciseById(id);

  const [phase, setPhase] = useState<ResultPhase>('analyzing');
  const [saved, setSaved] = useState(false);

  // MOCK analysis — runs once on mount after a short simulated delay.
  useEffect(() => {
    if (!exercise) return;
    const timeout = setTimeout(() => setPhase('result'), MOCK_ANALYSIS_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [exercise]);

  const analysis = useMemo(() => (exercise ? createMockAnalysisResult(exercise) : null), [exercise]);

  if (!exercise || !analysis) {
    return (
      <Screen>
        <Header title="Result not available" />
        <Button variant="primary" title="Back" onPress={() => router.replace('/exercise')} />
      </Screen>
    );
  }

  if (phase === 'analyzing') {
    return (
      <Screen>
        <Header title="Session Complete" />
        <Card variant="surface" gap={Spacing.five} style={styles.analyzingCard}>
          <ActivityIndicator size="large" color={theme.accentSecondary} />
          <Text style={[styles.analyzingHint, { color: theme.textSecondary }]}>
            Preparing your result…
          </Text>
        </Card>
      </Screen>
    );
  }

  const metrics = getPatientFacingMetrics(analysis);

  const handleSave = () => {
    if (saved) return;
    saveSession(analysis);
    setSaved(true);
  };

  return (
    <Screen>
      <Header title="Session Complete" />

      <ScoreCard
        variant="inverse"
        score={analysis.score}
        max={100}
        label="Your score"
        hint="out of 100"
      />

      <Text style={[styles.summary, { color: theme.heading }]}>{analysis.summary}</Text>
      <StatusChip label="Demo result" tone="accent" />

      <Card variant="surface" gap={Spacing.three}>
        {metrics.map((metric) => (
          <InfoRow key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </Card>

      <Button variant="primary" title="Done" onPress={() => router.replace('/exercise')} />
      <Button
        variant="outline"
        title={saved ? 'Saved' : 'Save session'}
        disabled={saved}
        onPress={handleSave}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  analyzingCard: {
    alignItems: 'center',
  },
  analyzingHint: {
    ...Type.body,
    fontSize: 17,
    lineHeight: 26,
    textAlign: 'center',
  },
  summary: {
    ...Type.label,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
    textAlign: 'center',
  },
});