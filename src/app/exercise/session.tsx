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
import { completedFeedback, pausedFeedback, setupFeedback, type FeedbackCue } from '@/exercise/feedback';
import { buildSessionMetrics, formatConsistencyLabel, formatDurationLabel, formatPaceLabel, formatRangeLabel } from '@/exercise/metrics';
import { getExerciseConfig } from '@/exercise/pose-configs';
import { createSessionId, createSessionRecord } from '@/exercise/session-store';
import { sessionPhaseLabel, type SessionPhase } from '@/exercise/session-phase';
import { sessionStore } from '@/exercise/session-storage';
import { SessionEngine } from '@/exercise/session-engine';
import { createExpoSpeechSink, VoiceFeedbackController } from '@/exercise/voice-feedback';

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
    feedback: setupFeedback(),
  });

  const phaseRef = useRef<SessionPhase>('ready');
  const secondsRef = useRef(0);

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
   * lives inside the controller, so it is safe to hand it every frame — it speaks
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

  useEffect(() => {
    if (phase !== 'running') return;
    const interval = setInterval(() => {
      setSeconds((s) => {
        const next = s + 1;
        secondsRef.current = next;
        return next;
      });
    }, 1000);
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

  const updateHud = useCallback((next: { reps: number; feedback: FeedbackCue }) => {
    setHud((prev) =>
      prev.reps === next.reps && prev.feedback.text === next.feedback.text && prev.feedback.tone === next.feedback.tone
        ? prev
        : { reps: next.reps, feedback: next.feedback },
    );
  }, []);

  /**
   * The pose-tracker view also emits a low-level `onFrame` camera event that
   * NOVEN has no consumer for — all exercise logic runs off `onPoseFrame`.
   * The prop is still declared required by PoseTrackerViewProps, so an inert
   * handler is passed rather than omitting it (dropping the listener would need
   * a device to confirm the native dispatcher tolerates it). This is the only
   * reason `onFrame` exists here.
   */
  const handleFrame = useCallback(() => {}, []);

  const handlePoseFrame = useCallback(
    (event: { nativeEvent: PoseFrameEventPayload }) => {
      // Phase is mirrored into a ref because `onPoseFrame` fires ~10x/s from the
      // native view and must never depend on a render having committed. Frames
      // that arrive while paused, before Start, or after End are dropped here and
      // never reach the engine, so a late frame cannot revive a finished session.
      if (phaseRef.current !== 'running') return;
      if (!engine) return;
      const result = engine.handlePoseFrame(event);
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

  const start = () => {
    engine?.reset();
    // Clear any throttling left over from a previous attempt so the first cue of
    // the new session is not swallowed by a cooldown.
    voiceRef.current?.reset();
    secondsRef.current = 0;
    setSeconds(0);
    setHud({ reps: 0, feedback: setupFeedback() });
    goToPhase('running');
    voiceRef.current?.announceStart();
  };

  const pause = () => {
    // Freeze the in-progress rep cycle so the movement that caused the pause
    // cannot be completed by the frames that follow it. Counted reps survive.
    // The HUD is not updated while paused (no pose frames are consumed), so the
    // engine also releases any held praise here instead of leaving it on screen.
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
      // Read the ref, not the render closure: `seconds` can be up to one tick
      // stale at the instant End is pressed, which would under-report duration.
      durationSeconds: secondsRef.current,
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
        // Intentionally swallowed — see above.
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
  // or the timer — none of which are readable from across a room.
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
      <Header title={exercise.name} />

      {hasCameraPermission ? (
        <View style={styles.cameraFrame}>
          {/*
            The tracker is unmounted once the session is over. The result screen
            is PUSHED, so this screen stays mounted behind it — and the native
            module only releases the camera / stops MediaPipe inference from
            OnViewDestroys, i.e. on a real unmount. Leaving the tracker mounted
            would keep the camera indicator lit and burn CPU on pose inference
            for the whole time the result screen is open. The 1:1 frame and the
            rest of the live-session layout are untouched; only the overlay drawn
            on top of the preview changed, to make it readable from a distance.
          */}
          {phase === 'completed' ? null : (
            <PoseTrackerView
              style={styles.camera}
              onFrame={handleFrame}
              onPoseFrame={handlePoseFrame}
            />
          )}
          <View
            pointerEvents="none"
            style={[styles.hudOverlay, phase === 'ready' ? styles.hudOverlayCentered : null]}>
            {/*
              Distance-readable HUD.

              The user is several feet from the phone with the screen facing away
              or at an angle, so the running state leads with a single dominant
              number and one short imperative underneath. Everything here is
              derived from the same `hud` state the engine produced this frame —
              there is no second source of truth.

              Contrast is carried by a solid scrim plus warm-white text rather than
              colour, so the HUD stays legible over any camera content and never
              depends on colour alone. `allowsFontScaling` is left on deliberately:
              enlarging the text is a feature for this audience.
            */}
            {phase === 'ready' ? (
              <View style={styles.readyPanel}>
                <Text style={styles.readyTitle}>GET READY</Text>
                <Text style={styles.readyLine}>Sit sideways to the camera</Text>
                <Text style={styles.readyHint}>
                  Keep your full upper body and legs visible
                </Text>
              </View>
            ) : (
              <View style={styles.runPanel}>
                {phaseBanner ? (
                  <Text accessibilityRole="header" style={styles.phaseBanner}>
                    {phaseBanner}
                  </Text>
                ) : null}
                <Text style={styles.repsLabel}>REPS</Text>
                <Text
                  accessibilityLabel={`${hud.reps} ${hud.reps === 1 ? 'rep' : 'reps'}`}
                  style={styles.repsValue}>
                  {hud.reps}
                </Text>
                <Text numberOfLines={2} style={styles.instruction}>
                  {instructionText}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : (
        <CameraPlaceholder />
      )}

      <StatusChip label={chipLabel} tone={chipTone} />
      <SessionTimer
        seconds={seconds}
        phase={phase}
        suggestedSeconds={exercise.durationSeconds}
      />

      {/*
        A completed session is terminal: the frozen metrics were already handed
        to the pushed result screen, so Pause/Resume must not be offered here or
        back-navigation could restart the timer and re-open counting. The result
        screen is pushed rather than replaced, so this screen remains reachable
        by pressing Back — it therefore needs its own way out, mirroring the
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
          <Button variant="primary" title="Start" onPress={start} />
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
    top: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  hudOverlayCentered: {
    justifyContent: 'center',
  },
  readyPanel: {
    alignItems: 'center',
    gap: Spacing.two,
    margin: Spacing.four,
    paddingVertical: Spacing.five,
    paddingHorizontal: Spacing.six,
    borderRadius: Radius.card,
    backgroundColor: 'rgba(18, 20, 19, 0.74)',
  },
  readyTitle: {
    ...Type.heading,
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    color: '#FAF9F6',
    textAlign: 'center',
    letterSpacing: 1,
  },
  readyLine: {
    ...Type.bodyEmphasis,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    color: '#FAF9F6',
    textAlign: 'center',
  },
  readyHint: {
    ...Type.body,
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '500',
    color: '#E7EFEB',
    textAlign: 'center',
  },
  runPanel: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    backgroundColor: 'rgba(18, 20, 19, 0.80)',
  },
  phaseBanner: {
    ...Type.heading,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '800',
    color: '#FAF9F6',
    textAlign: 'center',
    letterSpacing: 3,
  },
  repsLabel: {
    ...Type.label,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '800',
    color: '#FAF9F6',
    letterSpacing: 5,
  },
  repsValue: {
    fontSize: 84,
    lineHeight: 90,
    fontWeight: '800',
    color: '#FAF9F6',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  instruction: {
    ...Type.bodyEmphasis,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: '#FAF9F6',
    textAlign: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  controlButton: {
    flex: 1,
  },
});