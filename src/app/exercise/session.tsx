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
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { StatusChip } from '@/components/ui/status-chip';
import { Radius, Spacing, Type } from '@/constants/theme';
import { getExerciseById } from '@/data/exercises';
import { completedFeedback, pausedFeedback, setupFeedback, type FeedbackCue } from '@/exercise/feedback';
import { buildSessionMetrics, formatConsistencyLabel, formatDurationLabel, formatPaceLabel, formatRangeLabel } from '@/exercise/metrics';
import { getExerciseConfig } from '@/exercise/pose-configs';
import { createSessionId, createSessionRecord } from '@/exercise/session-store';
import { sessionPhaseLabel, type SessionPhase } from '@/exercise/session-phase';
import { sessionStore } from '@/exercise/session-storage';
import { SessionEngine } from '@/exercise/session-engine';
import { createExpoSpeechSink, VoiceFeedbackController } from '@/exercise/voice-feedback';
import { useTheme } from '@/hooks/use-theme';

type HudState = {
  reps: number;
  feedback: FeedbackCue;
};

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const exercise = getExerciseById(id);
  const theme = useTheme();

  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>('ready');
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [hud, setHud] = useState<HudState>({
    reps: 0,
    feedback: setupFeedback(),
  });

  const phaseRef = useRef<SessionPhase>('ready');

  /**
   * Phase is mirrored into a ref because `onPoseFrame` fires ~10x/s from the
   * native view and must never depend on a render having committed. The ref is
   * written synchronously here (NOT in an effect) so a pose frame arriving
   * between the tap and the next commit is attributed to the phase the user
   * just entered, instead of the previous one.
   */
  const goToPhase = useCallback((next: SessionPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const config = getExerciseConfig(id);

  /**
   * The whole per-frame exercise pipeline lives in SessionEngine (pure, and unit
   * tested); this screen only owns the session phase, the camera, and the HUD.
   *
   * The config comes from the catalogue id in the route, so every movement NOVEN
   * has real thresholds for runs on this one screen. An id with no config cannot
   * reach here: the exercise list and the detail screen both check first and
   * refuse to start a camera session they have no thresholds for.
   *
   * Built once, from that config, and never rebuilt: the engine is a stateful
   * object that accumulates every frame of the session, so replacing it
   * mid-session would throw the whole thing away. A lazy useState initialiser is
   * what gives "constructed exactly once" without touching a ref during render.
   */
  const [engine] = useState<SessionEngine | null>(() =>
    config === undefined ? null : new SessionEngine(config),
  );

  /**
   * Voice is a second channel for the SAME per-frame decision the HUD renders,
   * not a parallel state machine: both read `SessionFrameResult`. All throttling
   * lives inside the controller, so it is safe to hand it every frame â€” it speaks
   * only on a genuine state change or on a rep the detector actually completed.
   *
   * The controller is created and torn down by the effect below and reached only
   * through the ref from callbacks. That keeps it off the render path (a ref read
   * during render is a React Compiler error) and means a late native callback can
   * never speak into a screen that has already navigated away: after unmount the
   * ref is null and the controller it pointed at is disposed.
   */
  const voiceRef = useRef<VoiceFeedbackController | null>(null);

  useEffect(() => {
    const voice = new VoiceFeedbackController(createExpoSpeechSink());
    voiceRef.current = voice;
    // Spoken once on open, while the user is still beside the phone and can act
    // on it. This is the only place the setup copy is spoken.
    voice.announceSetup();
    return () => {
      voice.dispose();
      if (voiceRef.current === voice) voiceRef.current = null;
    };
  }, []);

  /**
   * Leaving a finished session is one-shot. Without this a double tap on Done
   * fires replace() twice, stacking a second /exercise entry the user could Back
   * into. The ref flips before the navigation call so re-entrant presses in the
   * same frame are ignored.
   */
  const leavingRef = useRef(false);
  const leaveSession = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    router.replace('/');
  };

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

  const updateHud = useCallback((next: { reps: number; feedback: FeedbackCue }) => {
    setHud((prev) =>
      prev.reps === next.reps && prev.feedback.text === next.feedback.text && prev.feedback.tone === next.feedback.tone
        ? prev
        : { reps: next.reps, feedback: next.feedback },
    );
  }, []);

  /**
   * The pose-tracker view also emits a low-level `onFrame` camera event that
   * NOVEN has no consumer for â€” all exercise logic runs off `onPoseFrame`.
   * The prop is still declared required by PoseTrackerViewProps, so an inert
   * handler is passed rather than omitting it (dropping the listener would need
   * a device to confirm the native dispatcher tolerates it). This is the only
   * reason `onFrame` exists here.
   */
  const handleFrame = useCallback(() => {}, []);

  /**
   * Every pose frame the tracker emits carries the engine's own elapsed answer.
   * There is deliberately NO interval on this screen: the seconds shown are the
   * engine's readiness-driven active time, and they change exactly when a frame
   * reports a new whole second. `setSeconds` with an unchanged value is a
   * no-op render, so the ~10 frames/s cost nothing when the clock is static.
   */
  const handlePoseFrame = useCallback(
    (event: { nativeEvent: PoseFrameEventPayload }) => {
      // Phase is mirrored into a ref because `onPoseFrame` fires ~10x/s from the
      // native view and must never depend on a render having committed. Frames
      // that arrive while paused, before Start, or after End are dropped here and
      // never reach the engine, so a late frame cannot revive a finished session.
      if (phaseRef.current !== 'running') return;
      if (!engine) return;
      const result = engine.handlePoseFrame(event);
      setSeconds(result.elapsedSeconds);
      updateHud(result);
      // Speech is handed the engine's own decision rather than the rendered HUD
      // value, and the controller decides whether that decision is worth saying.
      voiceRef.current?.onFrame(result);
    },
    [engine, updateHud],
  );

  if (!exercise || config === undefined) {
    return (
      <Screen>
        <Header title="Session not found" />
        <Button variant="primary" title="Back" onPress={() => router.replace('/exercise')} />
      </Screen>
    );
  }

  /**
   * Start is one-shot: the phase ref flips synchronously inside goToPhase, so a
   * second press in the same frame sees 'running' and is ignored. It only arms
   * the session â€” the clock stays at 0 until the first 'ready' pose frame banks
   * time, because the engine decides when the exercise position is actually held.
   */
  const start = () => {
    if (phaseRef.current !== 'ready') return;
    engine?.reset();
    // Clear any throttling left over from a previous attempt so the first cue of
    // the new session is not swallowed by a cooldown.
    voiceRef.current?.reset();
    setSeconds(0);
    setHud({ reps: 0, feedback: setupFeedback() });
    goToPhase('running');
    voiceRef.current?.announceStart();
  };

  const pause = () => {
    // Freeze the in-progress rep cycle so the movement that caused the pause
    // cannot be completed by the frames that follow it. Counted reps survive.
    // The engine also drops its clock anchor here, so the paused gap can never
    // be banked as active time when frames resume. The HUD is not updated while
    // paused (no pose frames are consumed), so the engine also releases any held
    // praise here instead of leaving it on screen.
    if (engine) updateHud(engine.pause());
    goToPhase('paused');
    voiceRef.current?.announcePause();
  };

  const resume = () => {
    // The readiness gate is deliberately NOT reset: re-settling after every
    // pause would be needlessly strict. Its per-frame anchor drift and
    // baseline-offset checks already reject repositioning done while paused,
    // because the pre-pause reference frame is still the drift comparison base.
    goToPhase('running');
    voiceRef.current?.announceResume();
  };

  const end = () => {
    // COMPLETED is terminal: a second End (double tap, or back-navigation from
    // the result screen) must not push a duplicate result or re-open counting.
    if (phaseRef.current === 'completed') return;

    const range = engine?.observedRange ?? null;

    const metrics = buildSessionMetrics({
      reps: engine?.reps ?? 0,
      // The engine is the single source of elapsed time: active seconds in the
      // exercise position, not wall-clock time since Start. There is no
      // secondsRef to go stale â€” the value the timer has been showing and the
      // value recorded here are the same number, from the same object.
      durationSeconds: engine?.elapsedSeconds ?? 0,
      repRanges: engine?.repRanges ?? [],
      rangeMinDeg: range?.min ?? null,
      rangeMaxDeg: range?.max ?? null,
    });

    // Stop counting and freeze the final numbers before navigating away, so no
    // pose frame can mutate the metrics that were just handed to the result.
    engine?.end();
    goToPhase('completed');
    // Announced before navigating. The controller is terminal from here, so this
    // is the last thing ever spoken for this session.
    voiceRef.current?.announceCompletion(metrics.reps);

    /*
     * Record the finished session so it can be seen again from the home screen.
     *
     * THIS IS THE ONLY PLACE A SESSION IS SAVED, and it sits below the terminal
     * guard at the top of this function, so every way of arriving twice is
     * already covered: a double tap on End returns early, a re-render does not
     * re-run this callback, back-navigation from the result screen finds
     * `phaseRef.current` already 'completed', and the result screen itself never
     * saves. The store also replaces rather than appends on a repeated id, so
     * even a re-entrant call could not produce a duplicate.
     *
     * The RAW metrics are stored, not the formatted strings below, so nothing
     * display-shaped is written to disk and the history can be re-rendered at any
     * text size without a re-save.
     *
     * Fire-and-forget, deliberately. A slow or failing write must not delay the
     * result screen, and the result screen reads the same numbers from the route
     * params whether or not the write landed. The rejection is absorbed for the
     * same reason the voice controller absorbs its own: the session really did
     * happen and the user really did get their result, so a storage failure
     * degrades the history list rather than the session.
     */
    void sessionStore
      .saveSession(
        createSessionRecord({
          id: createSessionId(),
          exerciseId: exercise.id,
          exerciseName: exercise.name,
          completedAt: new Date().toISOString(),
          metrics,
        }),
      )
      .catch(() => {
        // Intentionally swallowed â€” see above.
      });

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

  const chipLabel = sessionPhaseLabel(phase);
  const chipTone = phase === 'ready' || phase === 'completed' ? 'ready' : 'accent';

  // The HUD states the phase in words rather than relying on the chip, a colour,
  // or the timer â€” none of which are readable from across a room.
  const phaseBanner =
    phase === 'paused' ? 'PAUSED' : phase === 'completed' ? 'SESSION COMPLETE' : null;

  // Paused and completed get fixed wording so a stale exercise cue can never be
  // left standing on screen; while running, the engine's own cue is the truth.
  const instructionText =
    phase === 'completed'
      ? completedFeedback().text
      : phase === 'paused'
        ? pausedFeedback().text
        : hud.feedback.text;

   return (
    <Screen contentStyle={styles.content}>
      <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.exerciseName, { color: theme.heading }]}>
        {exercise.name}
      </Text>

      {/*
        The camera, unobstructed. The HUD used to be drawn ON TOP of the preview
        â€” a scrim and giant type over the video â€” which hid the person the whole
        screen exists to show. The layout is now a clean stack: camera first,
        then phase and clock, then guidance, then the controls. Nothing overlays
        the preview, and the tracker keeps its own full-width 1:1 frame.
      */}
      {hasCameraPermission ? (
        <View style={styles.cameraFrame}>
          {/*
            The tracker is unmounted once the session is over. The result screen
            is PUSHED, so this screen stays mounted behind it â€” and the native
            module only releases the camera / stops MediaPipe inference from
            OnViewDestroys, i.e. on a real unmount. Leaving the tracker mounted
            would keep the camera indicator lit and burn CPU on pose inference
            for the whole time the result screen is open.
          */}
          {phase === 'completed' ? null : (
            <PoseTrackerView
              style={styles.camera}
              onFrame={handleFrame}
              onPoseFrame={handlePoseFrame}
            />
          )}
        </View>
      ) : (
        <CameraPlaceholder />
      )}

      {/*
        Guidance lives below the camera instead of over the video: the phase
        banner when paused or complete, the running rep count plus the engine's
        own instruction while exercising, and the setup line before Start.
      */}
      {phase !== 'ready' && (
        <View style={styles.infoBar}>
          <View style={styles.infoBarLeft}>
            <SessionTimer
              seconds={seconds}
              phase={phase}
              suggestedSeconds={exercise.durationSeconds}
            />
          </View>
          <View style={styles.infoBarRight}>
            <Text numberOfLines={2} style={[styles.infoBarLabel, { color: theme.textSecondary }]}>GUIDANCE</Text>
            <Text numberOfLines={2} style={[styles.infoBarValue, { color: theme.text }]}>{instructionText}</Text>
          </View>
        </View>
      )}

      {phase !== 'ready' && (
        <Card variant="surface" padding="medium" style={styles.instructions}>
          <Text style={[styles.instructionsTitle, { color: theme.heading }]}>Instructions</Text>
          {exercise.instructions.map((instruction, index) => (
            <View key={index} style={styles.instructionItem}>
              <Text style={[styles.instructionBullet, { color: theme.accent }]}>â€¢</Text>
              <Text style={[styles.instructionStep, { color: theme.text }]}>{instruction}</Text>
            </View>
          ))}
        </Card>
      )}

      {phase === 'ready' && (
        <Card variant="surface" padding="medium" style={styles.instructions}>
          <Text style={[styles.instructionsTitle, { color: theme.heading }]}>Instructions</Text>
          {exercise.instructions.map((instruction, index) => (
            <View key={index} style={styles.instructionItem}>
              <Text style={[styles.instructionBullet, { color: theme.accent }]}>â€¢</Text>
              <Text style={[styles.instructionStep, { color: theme.text }]}>{instruction}</Text>
            </View>
          ))}
        </Card>
      )}

      {/*
        A completed session is terminal: the frozen metrics were already handed
        to the pushed result screen, so Pause/Resume must not be offered here or
        back-navigation could restart the timer and re-open counting. The result
        screen is pushed rather than replaced, so this screen remains reachable
        by pressing Back â€” it therefore needs its own way out, mirroring the
        result screen's Done button, instead of being a dead end.
      */}
      {phase === 'completed' ? (
        <Button variant="primary" title="Done" onPress={leaveSession} />
      ) : phase === 'ready' ? (
        // Start is only offered once the camera is actually available. Without
        // it there are no pose frames, so a session could be "completed" with 0
        // reps and report success for a workout that was never tracked. While
        // permission is pending or denied the CameraPlaceholder above already
        // explains what is needed.
        hasCameraPermission ? (
          <View style={styles.startButtonWrapper}>
            <Button variant="primary" title="Start" onPress={start} />
          </View>
        ) : null
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
  content: {
    // paddingTop only: paddingVertical here would overwrite Screen's own bottom
    // inset (see Screen), and the controls must never sit under Android's
    // gesture-navigation strip.
    gap: Spacing.four,
    paddingTop: Spacing.three,
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
  exerciseName: {
    ...Type.heading,
    width: '100%',
    textAlign: 'center',
  },
  startButtonWrapper: {
    width: '100%',
  },
  chipRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  guidance: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  guidanceTitle: {
    ...Type.heading,
    fontSize: 28,
    lineHeight: 36,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },
  phaseBanner: {
    ...Type.heading,
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: 3,
    textAlign: 'center',
  },
  repsLabel: {
    ...Type.label,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
  },
  repsValue: {
    fontSize: 64,
    lineHeight: 72,
    fontWeight: '800',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  readyLine: {
    ...Type.subheading,
    fontWeight: '600',
    lineHeight: 30,
    textAlign: 'center',
  },
  readyHint: {
    ...Type.body,
    lineHeight: 24,
    textAlign: 'center',
  },
  instruction: {
    ...Type.subheading,
    fontWeight: '600',
    lineHeight: 30,
    textAlign: 'center',
    paddingHorizontal: Spacing.two,
  },
  instructionBullet: {
    marginRight: Spacing.two,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  instructionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.two,
    width: '100%',
  },
  instructionStep: {
    ...Type.body,
    lineHeight: 22,
    flex: 1,
  },
  instructions: {
    gap: Spacing.two,
    width: '100%',
  },
  instructionsTitle: {
    ...Type.heading,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '800',
  },

  infoBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
    paddingHorizontal: Spacing.two,
    gap: Spacing.three,
  },
  infoBarLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  infoBarRight: {
    flex: 2,
    alignItems: 'flex-end',
  },
  infoBarLabel: {
    ...Type.label,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '800',
    letterSpacing: 2,
  },
  infoBarValue: {
    ...Type.subheading,
    fontWeight: '600',
    lineHeight: 24,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  controlButton: {
    flex: 1,
  },
});
