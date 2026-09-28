import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  PoseTrackerView,
  type PoseFrameEventPayload,
} from '../../../modules/pose-tracker';

import { describeLength, describeStepPosition } from '@/activities/activity-format';
import { GuidedSession, type GuidedSnapshot } from '@/activities/guided-session';
import type { GuidedActivity } from '@/activities/types';
import { buildSessionMetrics } from '@/exercise/metrics';
import { createSessionId, createSessionRecord } from '@/exercise/session-store';
import { sessionStore } from '@/exercise/session-storage';
import { SessionEngine } from '@/exercise/session-engine';
import { getGuidedPoseConfig } from '@/exercise/pose-configs';
import { Screen } from '@/components/layout/screen';
import { CameraPlaceholder } from '@/components/session/camera-placeholder';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { StatusChip } from '@/components/ui/status-chip';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * ============================================================================
 * The screen every Yoga, Meditation and Wellness session runs on.
 * ============================================================================
 *
 * WHY THE DETAIL AND THE SESSION ARE ONE SCREEN
 * A guided activity is a list of steps and a clock over the top of it. Splitting
 * those across two screens would mean a tap to find out what you are about to do
 * and another to start, and then a third to find out that you are finished —
 * three taps of navigation around content that fits on one screen. So this one
 * component shows the steps, runs them, and stops. The route files are three
 * lines each and carry no wording of their own, which is what keeps the three
 * activities from drifting apart.
 *
 * WHY THE TIMER IS NOT STATE IN HERE
 * Everything the user sees is a read of `GuidedSession.snapshot()`. This component
 * owns two pieces of state: which snapshot it last rendered, and a one-second
 * tick that makes it render again. The elapsed time itself is read from a clock
 * rather than counted by that tick, so a slow frame, a backgrounded app, or a
 * throttled timer cannot make the session lose or gain time.
 */

export type GuidedActivityScreenProps = {
  activity: GuidedActivity;
};

export function GuidedActivityScreen({ activity }: GuidedActivityScreenProps) {
  const theme = useTheme();
  const router = useRouter();

  /**
   * The session itself is a stateful object that accumulates elapsed time, so it
   * is built once for this activity and never replaced. A lazy initialiser gives
   * "exactly one instance" without touching a ref during render, which React
   * treats as a bug rather than an optimisation.
   */
  const [session] = useState(() => new GuidedSession(activity));

  /** The last snapshot rendered. The interval below only ever asks for a new one. */
  const [snapshot, setSnapshot] = useState<GuidedSnapshot>(() => session.snapshot());
  const [saving, setSaving] = useState(false);

  /** Camera permission state for camera-tracked steps. */
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);

  /** SessionEngine for the current camera-tracked step, if any (held in ref to avoid effect setState). */
  const cameraEngineRef = useRef<SessionEngine | null>(null);

  /** Whether a camera engine is active (for render condition). */
  const [hasCameraEngine, setHasCameraEngine] = useState(false);

  /** Camera HUD state for camera-tracked steps. */
  const [cameraHud, setCameraHud] = useState<{ reps: number; feedback: { text: string; tone: string } }>({
    reps: 0,
    feedback: { text: '', tone: 'neutral' },
  });

  const running = snapshot.phase === 'running';

  /** Current step's camera config, if any. */
  const currentStepConfig = snapshot.currentStep?.cameraConfigId
    ? getGuidedPoseConfig(snapshot.currentStep.cameraConfigId)
    : undefined;

  /** Whether we're currently on a camera-tracked step. */
  const isCameraStep = currentStepConfig !== undefined;

  /**
   * Stable on purpose: these three are dependencies of the effects below and of
   * each other, and a fresh function every render would make all of them churn
   * with it. The session never changes, so neither do these.
   *
   * Each reads the snapshot off the session rather than merging into state, so
   * what is rendered is always one coherent reading of the clock.
   */
  const start = useCallback(() => {
    session.reset();
    session.start();
    setSnapshot(session.snapshot());
  }, [session]);

  const pause = useCallback(() => {
    session.pause();
    setSnapshot(session.snapshot());
  }, [session]);

  const resume = useCallback(() => {
    session.resume();
    setSnapshot(session.snapshot());
  }, [session]);

  /**
   * Request camera permission for camera-tracked steps.
   */
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
          message: 'NOVEN uses the camera to track your movement during this pose.',
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

/**
   * Update camera engine when the camera-tracked step changes.
   * State updates are deferred to avoid synchronous setState in effect.
   */
  useEffect(() => {
    if (isCameraStep && currentStepConfig) {
      cameraEngineRef.current = new SessionEngine(currentStepConfig);
      // Defer all state updates to avoid synchronous setState in effect
      setTimeout(() => {
        setHasCameraEngine(true);
        setCameraHud({ reps: 0, feedback: { text: 'Get ready', tone: 'neutral' } });
      }, 0);
    } else {
      cameraEngineRef.current = null;
      setTimeout(() => {
        setHasCameraEngine(false);
      }, 0);
    }
  }, [isCameraStep, currentStepConfig]);

  /**
   * Handle pose frames from the camera for the current camera-tracked step.
   */
  const handlePoseFrame = useCallback(
    (event: { nativeEvent: PoseFrameEventPayload }) => {
      const engine = cameraEngineRef.current;
      if (!engine) return;
      if (snapshot.phase !== 'running') return;
      const result = engine.handlePoseFrame(event);
      setCameraHud({ reps: result.reps, feedback: result.feedback });
    },
    [snapshot.phase],
  );

  /**
   * Ends the session and records it.
   *
   * `how` is only ever the user's own decision, passed through for the wording of
   * what the result screen says. It is a label, not a number the app invents.
   *
   * The record is built from the real `SessionMetrics` with no repetitions, no
   * pose angles and no steadiness, because none of those were measured here. The
   * same builder produces null for every one of them, so a guided session cannot
   * acquire a number it has no observation behind.
   *
   * `leavingRef` makes this once-only, so a double tap on End, a re-render, or the
   * auto-save at the end of a session racing a press cannot record the same
   * session twice or push two result screens.
   */
  const leavingRef = useRef(false);
  const complete = useCallback(
    async (how: 'finished' | 'stopped') => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      setSaving(true);

      if (how === 'stopped') session.finishEarly();
      const final = session.snapshot();
      setSnapshot(final);

      const metrics = buildSessionMetrics({
        reps: 0,
        durationSeconds: final.elapsedSeconds,
        repRanges: [],
        rangeMinDeg: null,
        rangeMaxDeg: null,
      });

      const record = createSessionRecord({
        id: createSessionId(),
        exerciseId: activity.id,
        exerciseName: activity.name,
        completedAt: new Date().toISOString(),
        metrics,
        activityKind: activity.kind,
        stepsCompleted: final.stepsCompleted,
      });

      /*
       * Fire and forget, exactly as the camera session saves its own record. A
       * slow or failing write must not stand between the person and their
       * result, and the result screen is rendered from values already in hand
       * rather than by reading this record back, so a failed write costs the
       * history row and nothing else.
       */
      void sessionStore.saveSession(record).catch(() => {
        // Intentionally swallowed — see above.
      });

      /*
       * `replace`, not `push`. The result is the end of this session, and leaving
       * the session screen underneath it would mean the back gesture returns to a
       * finished timer rather than to the list the person came from.
       */
      router.replace({
        pathname: '/activity-result',
        params: {
          id: activity.id,
          kind: activity.kind,
          steps: String(final.stepsCompleted),
          seconds: String(final.elapsedSeconds),
          how,
        },
      });
    },
    [activity, router, session],
  );

  /**
   * One reading of the session, and the tick that asks for it again.
   *
   * The interval only exists while the session is running. When it is paused the
   * screen stops asking, so nothing re-renders behind the user's back, and when
   * the session finishes on its own the next reading notices and the effect
   * tears the interval down.
   */
  useEffect(() => {
    if (!running) return;
    const tick = () => setSnapshot(session.snapshot());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [running, session]);

  /**
   * A session that runs all the way to the end finishes by itself. Saving is
   * therefore not left to a button: reaching the end IS the completion, and if it
   * did not record itself, a person who put the phone down at the last second
   * would lose the session they had just done.
   */
  const autoSavedRef = useRef(false);
  useEffect(() => {
    if (!snapshot.finished || autoSavedRef.current) return;
    autoSavedRef.current = true;
    void complete('finished');
  }, [snapshot.finished, complete]);

  /**
   * Starting again after a finished session has to re-arm the once-only guard,
   * because that session has already been recorded and the new one is a
   * different session that is entitled to be saved.
   */
  const startFresh = useCallback(() => {
    leavingRef.current = false;
    autoSavedRef.current = false;
    setSaving(false);
    start();
  }, [start]);
  const phaseLabel =
    snapshot.phase === 'ready'
      ? 'Ready'
      : snapshot.phase === 'running'
        ? 'In progress'
        : snapshot.phase === 'paused'
          ? 'Paused'
          : 'Finished';
  const phaseTone = snapshot.phase === 'running' ? 'accent' : 'ready';

  const notStarted = snapshot.phase === 'ready';

  return (
    <Screen contentStyle={styles.content}>
      <Header title={activity.name} />

      {/*
        The countdown is the largest thing on the screen while a session runs,
        matching the size of the repetition counter on the camera session screen:
        from a chair, across a room, the number is what a person is watching.
      */}
      {notStarted ? (
        <Text style={[styles.summary, { color: theme.text }]}>{activity.summary}</Text>
      ) : (
        <View style={styles.clockBlock}>
          <Text
            accessibilityLabel={`${snapshot.remainingSeconds} seconds remaining`}
            style={[styles.clock, { color: theme.heading }]}>
            {minutesLabel(snapshot.remainingSeconds)}:{secondsLabel(snapshot.remainingSeconds)}
          </Text>
          <Text style={[styles.clockCaption, { color: theme.textSecondary }]}>
            {running ? 'Time remaining' : phaseLabel}
          </Text>
          <View style={[styles.track, { backgroundColor: theme.backgroundSelected }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: theme.accentSecondary, width: `${snapshot.progress * 100}%` },
              ]}
            />
          </View>
        </View>
      )}

      {/* Camera preview for camera-tracked steps */}
      {isCameraStep && running && hasCameraPermission && hasCameraEngine && (
        <View style={styles.cameraFrame}>
          <PoseTrackerView
            style={styles.camera}
            onFrame={() => {}}
            onPoseFrame={handlePoseFrame}
          />
          <View style={styles.cameraHudOverlay}>
            {cameraHud.reps === 0 ? (
              <View style={styles.cameraReadyPanel}>
                <Text style={styles.cameraReadyTitle}>GET READY</Text>
                <Text style={styles.cameraReadyLine}>
                  {currentStepConfig?.name ?? 'Pose'}
                </Text>
                <Text style={styles.cameraReadyHint}>
                  {cameraHud.feedback.text}
                </Text>
              </View>
            ) : (
              <View style={styles.cameraRunPanel}>
                <Text style={styles.cameraRepsLabel}>REPS</Text>
                <Text style={styles.cameraRepsValue}>{cameraHud.reps}</Text>
                <Text style={styles.cameraInstruction}>{cameraHud.feedback.text}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {isCameraStep && running && !hasCameraPermission && (
        <CameraPlaceholder />
      )}

      <StatusChip label={phaseLabel} tone={phaseTone} />

      {/*
        Before starting, the whole routine is on screen, because choosing to do it
        is the moment the person needs to see what it involves. While it runs, the
        step under way is stated in full at the top and the list stays below it as
        a reminder of what is coming.
      */}
      {notStarted ? null : (
        <Card variant="inverse" gap={Spacing.two}>
          <Text style={[styles.stepPosition, { color: 'rgba(250, 249, 246, 0.72)' }]}>
            {describeStepPosition(
              snapshot.stepsCompleted,
              activity.steps.length,
              activity.progressNoun,
            )}
          </Text>
          <Text style={[styles.stepTitle, { color: theme.accent }]}>
            {snapshot.currentStep?.title ?? 'Finished'}
          </Text>
          {snapshot.currentStep ? (
            <Text style={[styles.stepGuidance, { color: '#FAF9F6' }]}>
              {snapshot.currentStep.guidance}
            </Text>
          ) : null}
        </Card>
      )}

      <SectionHeader accent title="What you will do" />
      <Card variant="surface" gap={Spacing.four}>
        {activity.steps.map((step, index) => {
          const done = index < snapshot.stepsCompleted;
          const current = index === snapshot.stepIndex && !notStarted && !snapshot.finished;
          return (
            <View
              key={`${index}-${step.title}`}
              style={styles.stepRow}>
              <View
                style={[
                  styles.stepMarker,
                  {
                    backgroundColor: done || current ? theme.accentSoft : theme.backgroundSelected,
                  },
                ]}>
                <Text
                  style={[
                    styles.stepMarkerText,
                    { color: done || current ? theme.accent : theme.textSecondary },
                  ]}>
                  {index + 1}
                </Text>
              </View>
              <View style={styles.stepCopy}>
                <Text
                  style={[
                    styles.stepRowTitle,
                    { color: current ? theme.heading : theme.text },
                    current && styles.stepRowTitleCurrent,
                  ]}>
                  {step.title}
                </Text>
                <Text style={[styles.stepRowGuidance, { color: theme.textSecondary }]}>
                  {step.guidance}
                </Text>
                <Text style={[styles.stepRowLength, { color: theme.textSecondary }]}>
                  {describeLength(step.seconds)}
                </Text>
              </View>
            </View>
          );
        })}
      </Card>

      <SectionHeader accent title="When to stop" />
      <Card variant="tint">
        <Text style={[styles.safety, { color: theme.text }]}>{activity.safetyNote}</Text>
      </Card>

      {notStarted || snapshot.finished ? (
        // A finished session has already been recorded and its result pushed, so
        // Pause and End are not offered: they would be controls on a session that
        // is over. What is left is the one thing that makes sense, which is to do
        // it again.
        <Button
          variant="primary"
          title={snapshot.finished ? 'Start again' : 'Start'}
          onPress={startFresh}
        />
      ) : (
        <View style={styles.controls}>
          <Button
            variant="primary"
            title={snapshot.phase === 'paused' ? 'Resume' : 'Pause'}
            onPress={snapshot.phase === 'paused' ? resume : pause}
            fullWidth={false}
            style={styles.control}
          />
          <Button
            variant="outline"
            title="End"
            onPress={() => void complete('stopped')}
            loading={saving}
            fullWidth={false}
            style={styles.control}
          />
        </View>
      )}

      {/*
        Restarting a session that is under way discards real time, so it is a link
        rather than a button and it is not offered before anything has happened.
      */}
      {notStarted || snapshot.finished ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start the routine again"
          onPress={startFresh}
          style={({ pressed }) => [styles.reset, pressed && styles.resetPressed]}>
          <Text style={[styles.resetText, { color: theme.accentSecondary }]}>Start again</Text>
        </Pressable>
      )}
    </Screen>
  );
}

/** Whole minutes, at least two digits, so the layout never jumps. */
function minutesLabel(totalSeconds: number): string {
  return Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
}

function secondsLabel(totalSeconds: number): string {
  return (totalSeconds % 60).toString().padStart(2, '0');
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.three,
  },
  summary: {
    ...Type.body,
    fontSize: 19,
    lineHeight: 28,
  },
  clockBlock: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  clock: {
    ...Type.headingLarge,
    fontSize: 68,
    lineHeight: 76,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  clockCaption: {
    ...Type.label,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  track: {
    height: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  stepPosition: {
    ...Type.label,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stepTitle: {
    ...Type.subheading,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
  },
  stepGuidance: {
    ...Type.body,
    fontSize: 21,
    lineHeight: 30,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
  },
  stepMarker: {
    width: 32,
    height: 32,
    borderRadius: Radius.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepMarkerText: {
    ...Type.label,
    fontSize: 17,
    fontWeight: '700',
  },
  stepCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  stepRowTitle: {
    ...Type.bodyEmphasis,
    fontSize: 19,
    lineHeight: 26,
  },
  stepRowTitleCurrent: {
    fontWeight: '800',
  },
  stepRowGuidance: {
    ...Type.body,
    fontSize: 17,
    lineHeight: 25,
  },
  stepRowLength: {
    ...Type.label,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
  },
  safety: {
    ...Type.body,
    fontSize: 18,
    lineHeight: 27,
  },
  controls: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  control: {
    flex: 1,
  },
  reset: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  resetPressed: {
    opacity: 0.7,
  },
  resetText: {
    ...Type.label,
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
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
  cameraHudOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  cameraReadyPanel: {
    alignItems: 'center',
    gap: Spacing.two,
    margin: Spacing.four,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.six,
    borderRadius: Radius.card,
    backgroundColor: 'rgba(18, 20, 19, 0.74)',
  },
  cameraReadyTitle: {
    ...Type.heading,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    color: '#FAF9F6',
    textAlign: 'center',
    letterSpacing: 1,
  },
  cameraReadyLine: {
    ...Type.bodyEmphasis,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    color: '#FAF9F6',
    textAlign: 'center',
  },
  cameraReadyHint: {
    ...Type.body,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '500',
    color: '#E7EFEB',
    textAlign: 'center',
  },
  cameraRunPanel: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    backgroundColor: 'rgba(18, 20, 19, 0.80)',
  },
  cameraRepsLabel: {
    ...Type.label,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    color: '#FAF9F6',
    letterSpacing: 5,
  },
  cameraRepsValue: {
    fontSize: 84,
    lineHeight: 90,
    fontWeight: '800',
    color: '#FAF9F6',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  cameraInstruction: {
    ...Type.bodyEmphasis,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: '#FAF9F6',
    textAlign: 'center',
  },
});
