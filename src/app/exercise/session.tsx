import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/screen';
import { CameraPlaceholder } from '@/components/session/camera-placeholder';
import { SessionTimer } from '@/components/session/session-timer';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/ui/header';
import { StatusChip } from '@/components/ui/status-chip';
import { Spacing } from '@/constants/theme';
import { getExerciseById } from '@/data/exercises';

type SessionPhase = 'ready' | 'running' | 'paused';

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const exercise = getExerciseById(id);

  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>('ready');

  useEffect(() => {
    if (phase !== 'running') return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  if (!exercise) {
    return (
      <Screen>
        <Header title="Session not found" />
        <Button variant="primary" title="Back" onPress={() => router.replace('/exercise')} />
      </Screen>
    );
  }

  const start = () => setPhase('running');
  const pause = () => setPhase('paused');
  const resume = () => setPhase('running');

  const end = () => {
    setPhase('paused');
    setSeconds((s) => Math.max(1, s));
    router.push({ pathname: '/exercise/result', params: { id: exercise.id } });
  };

  const statusLabel = phase === 'ready' ? 'Ready' : 'Demo Mode';
  const timerRunning = phase === 'running';

  return (
    <Screen>
      <Header title={exercise.name} />

      <CameraPlaceholder />

      <StatusChip label={statusLabel} tone={phase === 'ready' ? 'ready' : 'accent'} />
      <SessionTimer
        seconds={seconds}
        running={timerRunning}
        suggestedSeconds={exercise.durationSeconds}
      />

      {phase === 'ready' ? (
        <Button variant="primary" title="Start" onPress={start} />
      ) : (
        <View style={styles.controlsRow}>
          <Button
            variant="primary"
            title={phase === 'paused' ? 'Resume' : 'Pause'}
            onPress={phase === 'paused' ? resume : pause}
            fullWidth={false}
            style={styles.controlButton}
          />
          <Button
            variant="outline"
            title="End"
            onPress={end}
            fullWidth={false}
            style={styles.controlButton}
          />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  controlsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  controlButton: {
    flex: 1,
  },
});