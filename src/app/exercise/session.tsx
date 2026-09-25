import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text, View } from 'react-native';

import {
  PoseTrackerView,
  type PoseFrameEventPayload,
} from '../../../modules/pose-tracker';
import { Screen } from '@/components/layout/screen';
import { CameraPlaceholder } from '@/components/session/camera-placeholder';
import { SessionTimer } from '@/components/session/session-timer';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/ui/header';
import { StatusChip } from '@/components/ui/status-chip';
import { Radius, Spacing, Type } from '@/constants/theme';
import { getExerciseById } from '@/data/exercises';
import { SEATED_KNEE_EXTENSION } from '@/exercise/configs';
import { phaseFeedback, presenceFeedback, priorityPhase, type FeedbackCue } from '@/exercise/feedback';
import { buildSessionMetrics, formatConsistencyLabel, formatDurationLabel, formatPaceLabel, formatRangeLabel } from '@/exercise/metrics';
import { angleFromTriplet } from '@/exercise/pose-utils';
import { RepDetector } from '@/exercise/rep-detector';

type SessionPhase = 'ready' | 'running' | 'paused' | 'completed';

type HudState = {
  reps: number;
  feedback: FeedbackCue;
};

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const exercise = getExerciseById(id);

  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>('ready');
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [hud, setHud] = useState<HudState>({
    reps: 0,
    feedback: { text: 'Ready', tone: 'ready' },
  });

  const phaseRef = useRef<SessionPhase>('ready');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const leftDetectorRef = useRef<RepDetector | null>(null);
  const rightDetectorRef = useRef<RepDetector | null>(null);
  const rangeRef = useRef<{ min: number; max: number } | null>(null);
  if (leftDetectorRef.current === null) leftDetectorRef.current = new RepDetector(SEATED_KNEE_EXTENSION.thresholds);
  if (rightDetectorRef.current === null) rightDetectorRef.current = new RepDetector(SEATED_KNEE_EXTENSION.thresholds);

  useEffect(() => {
    if (phase !== 'running') return;
    const interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [phase]);

  const requestCameraPermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setHasCameraPermission(false);
      return;
    }
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera access',
          message: 'NOVEN uses the camera to track your movement during the session.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      );
      setHasCameraPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
    } catch {
      setHasCameraPermission(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(requestCameraPermission, 0);
    return () => clearTimeout(timer);
  }, [requestCameraPermission]);

  const updateHud = useCallback((reps: number, feedback: FeedbackCue) => {
    setHud((prev) =>
      prev.reps === reps && prev.feedback.text === feedback.text && prev.feedback.tone === feedback.tone
        ? prev
        : { reps, feedback },
    );
  }, []);

  const handleFrame = useCallback(() => {}, []);

  const handlePoseFrame = useCallback(
    (event: { nativeEvent: PoseFrameEventPayload }) => {
      const { timestampMs, presence, landmarks } = event.nativeEvent;
      console.log(
        '[session] onPoseFrame',
        JSON.stringify({ timestampMs, presence, landmarkCount: landmarks.length }),
      );

      if (phaseRef.current !== 'running') return;

      const left = leftDetectorRef.current;
      const right = rightDetectorRef.current;
      if (!left || !right) return;

      if (presence !== 'tracked') {
        updateHud(hudRefReps(left, right), presenceFeedback(presence));
        return;
      }

      let repCompletedThisFrame = false;
      for (const side of SEATED_KNEE_EXTENSION.sides) {
        const detector = side === 'left' ? left : right;
        const angle = angleFromTriplet(
          landmarks,
          SEATED_KNEE_EXTENSION.triplets[side],
          SEATED_KNEE_EXTENSION.thresholds.minVisibility,
        );
        if (!Number.isFinite(angle)) continue;

        const current = rangeRef.current;
        rangeRef.current = current
          ? { min: Math.min(current.min, angle), max: Math.max(current.max, angle) }
          : { min: angle, max: angle };

        const outcome = detector.process({ angle, timestampMs });
        if (outcome.repCompleted) repCompletedThisFrame = true;
      }

      const phase = priorityPhase(left.currentPhase, right.currentPhase);
      const feedback = phaseFeedback(phase, repCompletedThisFrame);
      updateHud(hudRefReps(left, right), feedback);
    },
    [updateHud],
  );

  if (!exercise) {
    return (
      <Screen>
        <Header title="Session not found" />
        <Button variant="primary" title="Back" onPress={() => router.replace('/exercise')} />
      </Screen>
    );
  }

  const start = () => {
    leftDetectorRef.current?.reset();
    rightDetectorRef.current?.reset();
    rangeRef.current = null;
    setSeconds(0);
    setHud({ reps: 0, feedback: { text: 'Ready', tone: 'ready' } });
    setPhase('running');
  };

  const pause = () => setPhase('paused');
  const resume = () => setPhase('running');

  const end = () => {
    const left = leftDetectorRef.current;
    const right = rightDetectorRef.current;
    const totalReps = (left?.completedReps ?? 0) + (right?.completedReps ?? 0);
    const repRanges = [...(left?.completedRanges ?? []), ...(right?.completedRanges ?? [])];

    const metrics = buildSessionMetrics({
      reps: totalReps,
      durationSeconds: seconds,
      repRanges,
      rangeMinDeg: rangeRef.current?.min ?? null,
      rangeMaxDeg: rangeRef.current?.max ?? null,
    });

    setPhase('completed');
    router.push({
      pathname: '/exercise/result',
      params: {
        id: exercise.id,
        reps: String(metrics.reps),
        duration: formatDurationLabel(metrics.durationSeconds),
        pace: formatPaceLabel(metrics.paceRpm),
        range: formatRangeLabel(metrics.rangeMinDeg, metrics.rangeMaxDeg),
        consistency: formatConsistencyLabel(metrics.consistencyPct),
      },
    });
  };

  const chipLabel = phase === 'ready' ? 'Ready' : phase === 'running' ? 'Session in progress' : 'Paused';
  const chipTone = phase === 'ready' ? 'ready' : 'accent';
  const timerRunning = phase === 'running';

  return (
    <Screen contentStyle={styles.content}>
      <Header title={exercise.name} />

      {hasCameraPermission ? (
        <View style={styles.cameraFrame}>
          <PoseTrackerView
            style={styles.camera}
            onFrame={handleFrame}
            onPoseFrame={handlePoseFrame}
          />
          {phase !== 'ready' ? (
            <View pointerEvents="none" style={styles.hudOverlay}>
              <Text style={styles.hudReps}>Reps {hud.reps}</Text>
              <Text numberOfLines={1} style={styles.hudFeedback}>
                {hud.feedback.text}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <CameraPlaceholder />
      )}

      <StatusChip label={chipLabel} tone={chipTone} />
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

/** Reads rep counts out of the two detectors (used from both pose callbacks). */
function hudRefReps(left: RepDetector, right: RepDetector): number {
  return left.completedReps + right.completedReps;
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  cameraFrame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: '#202522',
  },
  camera: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  hudOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    backgroundColor: 'rgba(18, 20, 19, 0.72)',
  },
  hudReps: {
    ...Type.label,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    color: '#FAF9F6',
    fontVariant: ['tabular-nums'],
  },
  hudFeedback: {
    ...Type.label,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '600',
    color: '#FAF9F6',
    flexShrink: 1,
    textAlign: 'right',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  controlButton: {
    flex: 1,
  },
});