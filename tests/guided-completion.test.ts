import { check, suite } from './harness';

import { guidedCatalog, findGuidedActivity } from '../src/activities/catalog';
import { GuidedSession, PROGRESS_MAX } from '../src/activities/guided-session';
import { guidedStepCompletion, type GuidedActivity, type GuidedStep } from '../src/activities/types';
import { todayStatus } from '../src/activities/today';
import { YOGA_HOLD_SETTLE_MS, YogaHoldTracker, type YogaHoldSnapshot } from '../src/activities/yoga-hold';
import { getYogaPoseRule, YOGA_POSE_RULES } from '../src/activities/yoga-poses';
import { buildSessionMetrics } from '../src/exercise/metrics';
import {
  createSessionRecord,
  createSessionStore,
  type KeyValueStore,
} from '../src/exercise/session-store';
import type { LandmarkEventPayload, PoseLandmarkName } from '../../NOVEN/modules/pose-tracker';

/**
 * ============================================================================
 * A step is completed by something HAPPENING, not by the clock running out.
 * ============================================================================
 *
 * The defect these suites exist for: `GuidedSession` used to count a step as
 * finished the moment the clock passed the step's end. Nobody had to achieve
 * anything. A Yoga step whose hold was never once met still counted, because its
 * thirty-five seconds ran out, and the record said so.
 *
 * Everything here is driven through a clock the test moves by hand, and the Yoga
 * cases drive the real `YogaHoldTracker` on real landmark frames, so "the hold was
 * met" is established by the same code the app uses rather than asserted by
 * setting a flag.
 */

/** A clock the tests drive by hand, so every millisecond below is exact. */
function fakeClock(startMs = 1_000_000) {
  let nowMs = startMs;
  return {
    now: () => nowMs,
    advance(seconds: number) {
      nowMs += seconds * 1000;
      return nowMs;
    },
    advanceMs(ms: number) {
      nowMs += ms;
      return nowMs;
    },
  };
}

/** Builds a session over `steps` with the total derived the way the catalogue does. */
function activityWith(steps: GuidedStep[]): GuidedActivity {
  return {
    id: 'test-activity',
    kind: 'wellness',
    name: 'Test',
    summary: 'A test routine.',
    durationSeconds: steps.reduce((total, step) => total + step.seconds, 0),
    progressNoun: 'steps',
    safetyNote: 'Stop if you need to.',
    steps,
  };
}

/** A plain step: no camera, nothing to measure, finished when its time is up. */
function timed(title: string, seconds: number): GuidedStep {
  return { title, guidance: 'Carry on.', seconds };
}

/** A pose-hold step, which the clock may never finish on its own. */
function hold(title: string, seconds: number, ruleId: 'mountain' | 'chair' | 'warrior-ii'): GuidedStep {
  return { title, guidance: 'Hold the pose.', seconds, poseRuleId: ruleId };
}

/** A counted-movement step with a repetition target. */
function reps(title: string, seconds: number, targetReps: number): GuidedStep {
  return { title, guidance: 'Repeat the movement.', seconds, cameraConfigId: 'sit-to-stand', targetReps };
}

/** A landmark in the shape the pose tracker reports. */
function lm(name: PoseLandmarkName, x: number, y: number): LandmarkEventPayload {
  return { name, x, y, z: 0, visibility: 1, presence: 1 };
}

/** Shoulder and hip pairs, which every pose needs and which define the torso. */
function torso(shoulderY: number, hipY: number): LandmarkEventPayload[] {
  return [lm('LEFT_SHOULDER', 0.4, shoulderY), lm('RIGHT_SHOULDER', 0.6, shoulderY), lm('LEFT_HIP', 0.4, hipY), lm('RIGHT_HIP', 0.6, hipY)];
}

/**
 * A leg whose hip-knee-ankle angle is exactly `deg`, ankle derived from the knee
 * rather than guessed, so a knee "exactly on the ceiling" really is on it.
 */
function leg(
  side: 'LEFT' | 'RIGHT',
  hipX: number,
  hipY: number,
  kneeX: number,
  kneeY: number,
  shinLen: number,
  deg: number,
): LandmarkEventPayload[] {
  const thighAngle = Math.atan2(kneeY - hipY, kneeX - hipX);
  const offset = ((180 - deg) * Math.PI) / 180;
  let shinAngle = thighAngle + offset;
  if (Math.sin(shinAngle) < 0) shinAngle = thighAngle - offset;
  return [
    lm(`${side}_HIP`, hipX, hipY),
    lm(`${side}_KNEE`, kneeX, kneeY),
    lm(`${side}_ANKLE`, kneeX + Math.cos(shinAngle) * shinLen, kneeY + Math.sin(shinAngle) * shinLen),
  ];
}

/** Drops the hip landmarks from a frame that supplied its own. */
function withLegTorso(legs: LandmarkEventPayload[]): LandmarkEventPayload[] {
  return [...torso(0.3, 0.55).filter((joint) => !joint.name.endsWith('_HIP')), ...legs];
}

/** A standing person, upright, both legs straight, arms hanging: Mountain Pose. */
function mountainFrame(): LandmarkEventPayload[] {
  return [...torso(0.3, 0.55), lm('LEFT_KNEE', 0.42, 0.75), lm('RIGHT_KNEE', 0.58, 0.75), lm('LEFT_ANKLE', 0.42, 0.95), lm('RIGHT_ANKLE', 0.58, 0.95), lm('LEFT_WRIST', 0.38, 0.78), lm('RIGHT_WRIST', 0.62, 0.78)];
}

/** Chair Pose from the side: thighs near horizontal, so each knee reads 90. */
function chairFrame(): LandmarkEventPayload[] {
  return withLegTorso([
    ...leg('LEFT', 0.4, 0.62, 0.55, 0.62, 0.3, 90),
    ...leg('RIGHT', 0.6, 0.63, 0.55, 0.63, 0.3, 90),
  ]);
}

/** Warrior II from the front: hips at the level of the lower knee, arms out. */
function warriorFrame(): LandmarkEventPayload[] {
  return [
    ...withLegTorso([
      ...leg('LEFT', 0.4, 0.72, 0.45, 0.78, 0.2, 100),
      ...leg('RIGHT', 0.6, 0.72, 0.6, 0.75, 0.2, 180),
    ]),
    lm('LEFT_WRIST', 0.15, 0.3),
    lm('RIGHT_WRIST', 0.85, 0.3),
  ];
}

/**
 * A frame that really is the named pose, so a routine's own poses can be held for
 * real rather than stood in for.
 */
const VALID_FRAME_FOR = {
  mountain: mountainFrame,
  chair: chairFrame,
  'warrior-ii': warriorFrame,
} as const;

/** A frame with one knee out of place, which is not Mountain Pose. */
function brokenFrame(): LandmarkEventPayload[] {
  return mountainFrame().map((joint) => (joint.name === 'LEFT_KNEE' ? { ...joint, x: 0.2 } : joint));
}

/**
 * Holds one pose for real, against its own rule and its own valid frame, and calls
 * `onCompleted` on exactly the frame the tracker says the hold was met.
 *
 * The tracker's timeline is the frames' timestamps, so the session clock handed in
 * is advanced alongside it. That is what keeps the test honest about which of the
 * two clocks decided what: the tracker says the hold happened, and only then is
 * the session told.
 */
function holdPose(
  ruleId: keyof typeof VALID_FRAME_FOR,
  tracker: YogaHoldTracker,
  clock: ReturnType<typeof fakeClock>,
  onCompleted: () => void,
): YogaHoldSnapshot | null {
  const requiredMs = Math.round(getYogaPoseRule(ruleId)!.holdSeconds * 1000);
  const frame = VALID_FRAME_FOR[ruleId]();
  for (let t = 0; t <= requiredMs + YOGA_HOLD_SETTLE_MS + 200; t += 100) {
    clock.advanceMs(100);
    const reading = tracker.advance('tracked', frame, clock.now());
    if (reading.justCompleted) onCompleted();
    if (reading.state === 'completed') return reading;
  }
  return null;
}

export function run(): void {
  // ==========================================================================
  // The shape of the record
  // ==========================================================================
  suite('guided completion: the completed set is the one source of truth', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10), timed('Three', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);

    check('a new session has completed nothing', session.snapshot().completedStepIndices.length === 0);
    check('and its count agrees', session.snapshot().stepsCompleted === 0);

    session.start();
    clock.advance(10);
    const first = session.snapshot();
    check('the first finished step is recorded by index', first.completedStepIndices[0] === 0, first.completedStepIndices);
    check('the count is the size of that set', first.stepsCompleted === first.completedStepIndices.length);

    clock.advance(10);
    const second = session.snapshot();
    check('the set grows in order', second.completedStepIndices.join(',') === '0,1', second.completedStepIndices);
    check('with no duplicates', new Set(second.completedStepIndices).size === second.completedStepIndices.length);
    check('and never past the end of the activity', second.completedStepIndices.every((i) => i >= 0 && i < activity.steps.length));
    check('the session is not finished while a step is outstanding', !second.finished && second.stepsCompleted === 2, second.stepsCompleted);

    clock.advance(10);
    const third = session.snapshot();
    check('the session is finished once every step is in it', third.finished && third.stepsCompleted === 3, third.stepsCompleted);
    check('and the set is the whole activity', third.completedStepIndices.join(',') === '0,1,2', third.completedStepIndices);
  });

  suite('guided completion: the set is a value, not the session\'s own array', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(10);

    const snapshot = session.snapshot();
    const stolen = snapshot.completedStepIndices as number[];
    stolen.push(99);

    check('writing to the snapshot does not reach the session', session.snapshot().completedStepIndices.join(',') === '0', session.snapshot().completedStepIndices);
    check('and the count is unaffected', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
  });

  suite('guided completion: the set survives being stored and read back', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10), timed('Three', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(15);
    session.finishEarly();

    const stored = session.snapshot().completedStepIndices;
    const roundTripped = JSON.parse(JSON.stringify(stored)) as number[];

    check('it is plain data', Array.isArray(roundTripped), roundTripped);
    check('the indices are whole numbers', roundTripped.every((index) => Number.isSafeInteger(index)), roundTripped);
    check('and it still says the same thing', roundTripped.join(',') === stored.join(','), { roundTripped, stored });
    check('the count still equals its length', stored.length === session.snapshot().stepsCompleted);
  });

  // ==========================================================================
  // A timed step is finished by its own clock
  // ==========================================================================
  suite('guided completion: a timed step is finished by its own time', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    clock.advance(9.5);
    check('it is not finished a half-second early', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    clock.advance(0.5);
    check('and is finished exactly on the boundary', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
    check('having moved on to the next step', session.snapshot().stepIndex === 1);
  });

  suite('guided completion: a breathing step is finished by its configured length', () => {
    const breathing = findGuidedActivity('five-minute-breathing');
    check('the breathing routine is still in the catalogue', breathing !== undefined);
    if (breathing === undefined) return;

    const breathe = breathing.steps.find((step) => step.breathingTechniqueId === 'box-breathing');
    check('it has a paced-breathing step', breathe !== undefined);
    if (breathe === undefined) return;

    const clock = fakeClock();
    const session = new GuidedSession(breathing, clock.now);
    session.start();
    // Settle and Notice first, which are the two timed stages before it.
    clock.advance(breathing.steps[0].seconds + breathing.steps[1].seconds);

    const onBreathingStep = session.snapshot();
    check('the session is on the breathing stage', onBreathingStep.currentStep?.title === breathe.title, onBreathingStep.currentStep?.title);
    const before = onBreathingStep.stepsCompleted;

    clock.advance(breathe.seconds - 1);
    check('a breathing stage is not finished before its length', session.snapshot().stepsCompleted === before, session.snapshot().stepsCompleted);
    clock.advance(1);
    check('and is finished when the configured length is reached', session.snapshot().stepsCompleted === before + 1, session.snapshot().stepsCompleted);
    check('because nothing is being measured: it is paced, not watched', guidedStepCompletion(breathe) === 'timed', guidedStepCompletion(breathe));
  });

  // ==========================================================================
  // The defect: a hold is NOT completed by a timeout
  // ==========================================================================
  suite('guided completion: a pose is never credited just for running out of time', () => {
    /*
     * The exact regression. A single pose step, its budget longer than the pose's
     * hold, and nobody holding anything at all: the person sat there, the step's
     * thirty-five seconds passed, and the old session called it done.
     */
    const activity = activityWith([timed('Settle', 30), hold('Mountain', 35, 'mountain')]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    clock.advance(30);
    check('the timed stage before it is credited', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
    check('and the session is waiting on the pose', session.snapshot().currentStep?.poseRuleId === 'mountain');

    clock.advance(35);
    const after = session.snapshot();
    check('the pose step is NOT credited by its budget running out', after.stepsCompleted === 1, after.stepsCompleted);
    check('the completed set does not contain it', !after.completedStepIndices.includes(1), after.completedStepIndices);
    check('and the session has finished without it', after.finished, after.phase);
    check('so the history would read one of two', after.stepsCompleted < activity.steps.length);
  });

  suite('guided completion: letting a pose lapse ends the session rather than stranding', () => {
    /*
     * A step cannot be skipped, so once the pose's budget is used up there is
     * nothing honest left to do with this activity. Finishing with the step uncounted
     * is the only outcome that neither credits an unheld pose nor leaves somebody
     * stuck on a screen they cannot leave.
     */
    const activity = activityWith([hold('Mountain', 35, 'mountain'), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    clock.advance(activity.durationSeconds);
    const after = session.snapshot();

    check('the session is over', after.finished, after.phase);
    check('the pose is not in the completed set', after.completedStepIndices.length === 0, after.completedStepIndices);
    check('nor is the step after it', after.stepsCompleted === 0, after.stepsCompleted);
    check('and the rest of the routine did not run', after.currentStep?.title === 'Mountain', after.currentStep?.title);
  });

  suite('guided completion: every pose step in the catalogue is budgeted past its hold', () => {
    /*
     * The property the two suites above depend on for being usable rather than a
     * trap: a person who does the pose properly always completes it inside its
     * budget, so the session only ends early for somebody who genuinely did not.
     */
    for (const kind of ['yoga', 'meditation', 'wellness'] as const) {
      for (const activity of guidedCatalog(kind)) {
        for (const step of activity.steps) {
          if (step.poseRuleId === undefined) continue;
          const rule = getYogaPoseRule(step.poseRuleId);
          check(
            `${activity.id}/${step.title} has a hold that fits inside its budget`,
            rule !== undefined && step.seconds > rule.holdSeconds + YOGA_HOLD_SETTLE_MS / 1000,
            { seconds: step.seconds, hold: rule?.holdSeconds },
          );
          check(
            `${activity.id}/${step.title} is answered by the tracker, not the clock`,
            guidedStepCompletion(step) === 'hold',
            guidedStepCompletion(step),
          );
        }
      }
    }
  });

  // ==========================================================================
  // A pose that IS held completes the step, and does so early
  // ==========================================================================
  suite('guided completion: a held pose completes its step on the frame that held it', () => {
    const activity = activityWith([timed('Settle', 30), hold('Mountain', 35, 'mountain'), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    const tracker = new YogaHoldTracker(getYogaPoseRule('mountain')!);
    session.start();

    clock.advance(30);
    check('the session is on the pose step', session.snapshot().currentStep?.poseRuleId === 'mountain');

    // Advance in step with the person actually holding the pose.
    const heldFor = Math.round(YOGA_POSE_RULES.mountain.holdSeconds * 1000);
    let completed = false;
    let banked: YogaHoldSnapshot | null = null;
    for (let t = 0; t <= heldFor + YOGA_HOLD_SETTLE_MS + 200; t += 100) {
      clock.advanceMs(100);
      const reading = tracker.advance('tracked', mountainFrame(), clock.now());
      if (reading.justCompleted) completed = session.completeStep(session.snapshot().stepIndex);
      banked = reading;
    }

    const after = session.snapshot();
    check('the tracker really did bank the hold', banked?.state === 'completed', banked);
    check('and the step was completed', completed);
    check('both earlier steps are in the set', after.completedStepIndices.join(',') === '0,1', after.completedStepIndices);
    check('the session moved on to the rest stage', after.currentStep?.title === 'Rest', after.currentStep?.title);
    check('the pose is finished with time still unused on it', after.stepElapsedSeconds === 0, after.stepElapsedSeconds);
  });

  suite('guided completion: a completed pose does not leave its unused budget behind', () => {
    const activity = activityWith([hold('Mountain', 35, 'mountain'), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    clock.advance(20);
    const before = session.snapshot().remainingSeconds;
    session.completeStep(session.snapshot().stepIndex);
    const after = session.snapshot();

    check('the countdown drops by the fifteen seconds the pose did not use', before - after.remainingSeconds === 15, { before, after: after.remainingSeconds });
    check('it never counts seconds that are not going to be spent', after.remainingSeconds === 30, after.remainingSeconds);
    check('and the progress bar has moved on with the step', after.progress > 0, after.progress);
  });

  suite('guided completion: a pose broken part-way through is never credited', () => {
    const activity = activityWith([hold('Mountain', 35, 'mountain'), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    const tracker = new YogaHoldTracker(getYogaPoseRule('mountain')!);
    session.start();

    const requiredMs = Math.round(YOGA_POSE_RULES.mountain.holdSeconds * 1000);
    let banked: YogaHoldSnapshot | null = null;
    for (let t = 0; t <= requiredMs - 600; t += 100) {
      clock.advanceMs(100);
      banked = tracker.advance('tracked', mountainFrame(), clock.now());
    }
    // The pose falls apart with most of the hold still owed.
    clock.advanceMs(100);
    banked = tracker.advance('tracked', brokenFrame(), clock.now());
    clock.advance(activity.durationSeconds);

    const after = session.snapshot();
    check('the run of frames before the break had not completed', (banked?.holdSeconds ?? 0) < YOGA_POSE_RULES.mountain.holdSeconds, banked?.holdSeconds);
    check('nothing was credited', after.stepsCompleted === 0, after.stepsCompleted);
    check('and the session ended without the pose', after.finished);
  });

  suite('guided completion: a pose held to the end finishes the whole routine', () => {
    /*
     * The full real routine, every stage answered the way the app answers it: the
     * timed stages by the clock, the three poses by a genuine unbroken hold.
     */
    const activity = findGuidedActivity('standing-pose-holds');
    check('the pose routine is still in the catalogue', activity !== undefined);
    if (activity === undefined) return;

    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    let steps = 0;
    while (steps < activity.steps.length) {
      const before = session.snapshot();
      if (before.finished) break;
      const step = before.currentStep;
      if (step === null) break;
      if (step.poseRuleId === undefined) {
        clock.advance(step.seconds);
      } else {
        holdPose(step.poseRuleId, new YogaHoldTracker(getYogaPoseRule(step.poseRuleId)!), clock, () =>
          session.completeStep(session.snapshot().stepIndex),
        );
      }
      steps = session.snapshot().stepsCompleted;
    }

    const after = session.snapshot();
    check('every stage completed', after.stepsCompleted === activity.steps.length, `${after.stepsCompleted}/${activity.steps.length}`);
    check('the set holds them all, in order', after.completedStepIndices.join(',') === activity.steps.map((_, index) => index).join(','), after.completedStepIndices);
    check('the session finished', after.finished, after.phase);
    check('the progress bar is full', after.progress === PROGRESS_MAX, after.progress);
    check('and nothing is left to count down', after.remainingSeconds === 0, after.remainingSeconds);
    check('the routine took less than its budget, because three poses ended early', after.elapsedSeconds < activity.durationSeconds, { elapsed: after.elapsedSeconds, budget: activity.durationSeconds });
  });

  // ==========================================================================
  // Exactly once
  // ==========================================================================
  suite('guided completion: the same completion reported twice counts once', () => {
    const activity = activityWith([hold('Mountain', 35, 'mountain'), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    const index = session.snapshot().stepIndex;
    check('the first report completes the step', session.completeStep(index) === true);
    check('and the count is one', session.snapshot().stepsCompleted === 1);

    for (let frame = 0; frame < 20; frame += 1) {
      check(`a repeated report on frame ${frame} adds nothing`, session.completeStep(index) === false);
    }
    check('the count is still one', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
    check('and the set still has one entry', session.snapshot().completedStepIndices.length === 1, session.snapshot().completedStepIndices);
    check('the duplicate did not skip the next step', session.snapshot().stepIndex === 1, session.snapshot().stepIndex);
  });

  suite('guided completion: nothing can be completed once the session is over', () => {
    /*
     * The case that matters is a session that ended with a step still outstanding:
     * a pose whose budget ran out. A camera frame arriving afterwards must not be
     * able to reopen a session that has already been written to the history.
     */
    const activity = activityWith([timed('One', 10), hold('Mountain', 35, 'mountain')]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(activity.durationSeconds);

    const over = session.snapshot();
    check('the session is finished with the pose outstanding', over.finished && over.stepsCompleted === 1, over.stepsCompleted);
    const poseIndex = over.stepIndex;
    check('and the outstanding step is still the one under way', poseIndex === 1, poseIndex);

    check('a late hold reported afterwards is refused', session.completeStep(poseIndex) === false);
    check('the count is untouched', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
    check('and the pose never entered the completed set', !session.snapshot().completedStepIndices.includes(poseIndex), session.snapshot().completedStepIndices);
  });

  suite('guided completion: a step cannot be completed before Start', () => {
    const activity = activityWith([timed('One', 10), hold('Mountain', 35, 'mountain')]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);

    check('a ready session refuses a completion', session.completeStep(0) === false);
    check('and has completed nothing', session.snapshot().stepsCompleted === 0);
  });

  // ==========================================================================
  // Order: no skipping, no future steps
  // ==========================================================================
  suite('guided completion: a step can only be completed when it is the one under way', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10), timed('Three', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    check('a later step cannot be completed from the first', session.completeStep(1) === false);
    check('nor the one after that', session.completeStep(2) === false);
    check('nothing was credited by either', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    check('and the session has not moved on', session.snapshot().stepIndex === 0, session.snapshot().stepIndex);

    clock.advance(10);
    check('the step that really finished is the current one', session.snapshot().stepIndex === 1, session.snapshot().stepIndex);
    check('and going back to the step before it is refused', session.completeStep(0) === false);
    check('so the set can never contain a gap', session.snapshot().completedStepIndices.join(',') === '0', session.snapshot().completedStepIndices);
  });

  suite('guided completion: an index outside the activity is refused', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    check('a negative index is refused', session.completeStep(-1) === false);
    check('an index past the end is refused', session.completeStep(2) === false);
    check('a wildly out-of-range index is refused', session.completeStep(9999) === false);
    check('a decimal index is refused', session.completeStep(0.5) === false);
    check('and the step under way is still the only one there', session.snapshot().completedStepIndices.length === 0, session.snapshot().completedStepIndices);
    check('with the session still where it was', session.snapshot().stepIndex === 0, session.snapshot().stepIndex);
  });

  // ==========================================================================
  // Repetition targets
  // ==========================================================================
  suite('guided completion: a step with a target is finished by reaching it', () => {
    const activity = activityWith([reps('Sit and Stand', 45, 8), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    check('the step is answered by a repetition count', guidedStepCompletion(activity.steps[0]) === 'reps', guidedStepCompletion(activity.steps[0]));

    for (let reps = 0; reps < 8; reps += 1) {
      clock.advance(5);
      session.reportStepReps(reps);
      check(`seven repetitions do not finish it (saw ${reps})`, session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    }

    check('the eighth does', session.reportStepReps(8) === true);
    check('and the step is complete', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
    check('having moved to the rest stage', session.snapshot().currentStep?.title === 'Rest', session.snapshot().currentStep?.title);
    check('well before its budget ran out', session.snapshot().elapsedSeconds < 45, session.snapshot().elapsedSeconds);
  });

  suite('guided completion: a target is reached exactly once however many times it is reported', () => {
    const activity = activityWith([reps('Sit and Stand', 45, 3), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    check('the target completes the step', session.reportStepReps(3) === true);
    for (let frame = 0; frame < 30; frame += 1) {
      check(`the same running total does not complete it again (frame ${frame})`, session.reportStepReps(3) === false);
    }
    check('a larger total does not either', session.reportStepReps(40) === false);
    check('the step is still counted once', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
  });

  suite('guided completion: repetitions mean nothing to a step with no target', () => {
    const activity = activityWith([reps('Sit and Stand', 45, 8), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    activity.steps[0].targetReps = undefined;

    check('a step declaring no target is a timed step', guidedStepCompletion(activity.steps[0]) === 'timed', guidedStepCompletion(activity.steps[0]));
    for (let reps = 1; reps <= 40; reps += 4) {
      check(`${reps} repetitions do not finish a timed step`, session.reportStepReps(reps) === false);
    }
    check('so the step is still under way', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    clock.advance(45);
    check('and it finishes on its own clock instead', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
  });

  suite('guided completion: a repetition count that means nothing is ignored', () => {
    const activity = activityWith([reps('Sit and Stand', 45, 5), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    check('a reading below the target is ignored', session.reportStepReps(4) === false);
    check('a negative count is ignored', session.reportStepReps(-5) === false);
    check('zero is ignored', session.reportStepReps(0) === false);
    check('a count that is not a number is ignored', session.reportStepReps(Number.NaN) === false);
    check('an infinite count is ignored', session.reportStepReps(Number.POSITIVE_INFINITY) === false);
    check('and nothing was completed by any of them', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    check('the step is still the one under way', session.snapshot().currentStep?.title === 'Sit and Stand', session.snapshot().currentStep?.title);
  });

  suite('guided completion: a repetition count cannot finish a step that is held', () => {
    /*
     * The two paths that can complete a step have to agree about what KIND of step
     * they are looking at, or the same step can be finished two contradictory ways.
     * `guidedStepCompletion` gives a `poseRuleId` priority over a `targetReps`, so a
     * step carrying both is a hold - and asking one camera frame to satisfy a shape
     * and a count is not something either measurement should quietly settle alone.
     *
     * No activity declares both today, so this cannot fail in the app as it stands.
     * It is pinned because the day one does, the answer must already be right: a
     * pose nobody ever held must not be credited because a count arrived.
     */
    const step = reps('Mountain and count', 35, 3);
    step.poseRuleId = 'mountain';
    const activity = activityWith([step]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    check('the step is a hold step, the pose winning over the count', guidedStepCompletion(activity.steps[0]) === 'hold', guidedStepCompletion(activity.steps[0]));
    check('reaching the target does not finish it', session.reportStepReps(3) === false);
    check('and a wild over-count does not either', session.reportStepReps(9_999) === false);
    check('so nothing was credited by a count', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    check('the step under way is still that step', session.snapshot().currentStep?.title === 'Mountain and count', session.snapshot().currentStep?.title);

    clock.advance(35);
    check('the clock cannot finish it either, for the same reason', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    check('so the step budget lapsing ends the activity with it uncounted', session.snapshot().finished, session.snapshot().phase);

    check('only holding the pose finishes it', session.completeStep(0) === false);
  });

  suite('guided completion: the hold still finishes a step that also declares a target', () => {
    const step = reps('Mountain and count', 35, 3);
    step.poseRuleId = 'mountain';
    const activity = activityWith([step, timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(5);

    check('the hold is accepted', session.completeStep(0) === true);
    check('and completes the step exactly once', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
    check('the count still means nothing to it', session.reportStepReps(3) === false);
  });

  suite('guided completion: no activity in the catalogue declares a target yet', () => {
    /*
     * The honest state of this feature, pinned so it cannot drift silently. The
     * mechanism exists and is tested above; no routine uses it, because none of
     * them has a target that was measured rather than guessed. Until one does,
     * every counted-movement step is a timed budget and behaves exactly as it did.
     */
    const withTargets: string[] = [];
    for (const kind of ['yoga', 'meditation', 'wellness'] as const) {
      for (const activity of guidedCatalog(kind)) {
        for (const [index, step] of activity.steps.entries()) {
          if (step.targetReps === undefined) continue;
          withTargets.push(`${activity.id}/${index}`);
        }
      }
    }
    check('nothing in the catalogue has been given a target', withTargets.length === 0, withTargets.join(','));
  });

  // ==========================================================================
  // Pausing
  // ==========================================================================
  suite('guided completion: time spent paused completes nothing', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(5);
    session.pause();

    clock.advance(600);
    check('a long pause moves no step', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    check('and the session is still paused rather than finished', session.snapshot().phase === 'paused', session.snapshot().phase);

    session.resume();
    check('the step is picked up where it was left', session.snapshot().stepElapsedSeconds === 5, session.snapshot().stepElapsedSeconds);
    clock.advance(5);
    check('and completes on its own time once running again', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
  });

  suite('guided completion: a pose reported while paused is not credited', () => {
    const activity = activityWith([hold('Mountain', 35, 'mountain'), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(5);
    session.pause();

    clock.advance(20);
    check('the completion is refused while paused', session.completeStep(session.snapshot().stepIndex) === false);
    check('so nothing was credited', session.snapshot().stepsCompleted === 0, session.snapshot().stepsCompleted);
    check('even though the pose was being held', session.snapshot().stepElapsedSeconds === 5, session.snapshot().stepElapsedSeconds);
  });

  suite('guided completion: pausing and resuming keeps the step where it was', () => {
    const activity = activityWith([timed('One', 30), timed('Two', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    clock.advance(20);
    session.pause();
    clock.advance(300);
    session.resume();

    check('the step has not moved on', session.snapshot().stepIndex === 0, session.snapshot().stepIndex);
    check('and its own clock did not run during the pause', session.snapshot().stepElapsedSeconds === 20, session.snapshot().stepElapsedSeconds);
    clock.advance(10);
    check('so it finishes exactly on its own thirty seconds', session.snapshot().stepsCompleted === 1, session.snapshot().stepsCompleted);
  });

  // ==========================================================================
  // Ending early
  // ==========================================================================
  suite('guided completion: ending early credits only what really finished', () => {
    const activity = activityWith([timed('One', 10), timed('Two', 10), timed('Three', 10)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    clock.advance(12);
    session.finishEarly();
    const after = session.snapshot();

    check('the step that ran is credited', after.completedStepIndices.join(',') === '0', after.completedStepIndices);
    check('the one part-way through is not', after.stepsCompleted === 1, after.stepsCompleted);
    check('nor is the one after it', !after.completedStepIndices.includes(2), after.completedStepIndices);
    check('and the time it really ran is kept', after.elapsedSeconds === 12, after.elapsedSeconds);
    check('the session is over', after.finished, after.phase);
  });

  suite('guided completion: ending early is honest when a pose was left unheld', () => {
    const activity = activityWith([timed('Settle', 30), hold('Mountain', 35, 'mountain'), timed('Rest', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    clock.advance(35);
    session.finishEarly();
    const after = session.snapshot();

    check('only the stage before the pose is credited', after.completedStepIndices.join(',') === '0', after.completedStepIndices);
    check('so the routine reads as one of three', after.stepsCompleted === 1, after.stepsCompleted);
    check('and not as a finished session', after.finished && after.stepsCompleted < activity.steps.length);
  });

  suite('guided completion: starting again clears everything', () => {
    const activity = activityWith([timed('One', 10), hold('Mountain', 35, 'mountain')]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(10);
    check('a step was completed', session.snapshot().stepsCompleted === 1);

    session.reset();
    const fresh = session.snapshot();
    check('the completed set is empty', fresh.completedStepIndices.length === 0, fresh.completedStepIndices);
    check('the count is zero', fresh.stepsCompleted === 0);
    check('the clock is cleared', fresh.elapsedSeconds === 0, fresh.elapsedSeconds);
    check('and the session is ready again', fresh.phase === 'ready', fresh.phase);
    check('back on the first step', fresh.stepIndex === 0);
  });

  // ==========================================================================
  // Progress still behaves
  // ==========================================================================
  suite('guided completion: the progress bar stays inside its bounds and never goes back', () => {
    const activity = activityWith([timed('One', 30), hold('Mountain', 35, 'mountain'), timed('Three', 30)]);
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();

    let previous = session.snapshot().progress;
    for (let tick = 0; tick < 200; tick += 1) {
      clock.advance(1);
      const { progress } = session.snapshot();
      if (progress < 0 || progress > PROGRESS_MAX) {
        check(`progress stays within 0..1 (saw ${progress})`, false);
        return;
      }
      if (progress < previous) {
        check(`progress never goes backwards (saw ${previous} then ${progress})`, false);
        return;
      }
      previous = progress;
    }
    check('progress stays within 0..1 over a long run', true);
    check('and never goes backwards', true);
    check('a session that ran out of time with a pose unheld is not full', previous < PROGRESS_MAX, previous);
  });

  // ==========================================================================
  // What actually reaches the history
  // ==========================================================================
  suite('guided completion: the session store records what was really done', async () => {
    const routine = findGuidedActivity('standing-pose-holds');
    check('the pose routine is in the catalogue', routine !== undefined);
    if (routine === undefined) return;
    const activity: GuidedActivity = routine;

    const metrics = buildSessionMetrics({
      reps: 0,
      durationSeconds: 60,
      repRanges: [],
      rangeMinDeg: null,
      rangeMaxDeg: null,
    });

    const written = new Map<string, string>();
    const backend: KeyValueStore = {
      getItem: async (key) => written.get(key) ?? null,
      setItem: async (key, value) => {
        written.set(key, value);
      },
      removeItem: async (key) => {
        written.delete(key);
      },
    };
    const store = createSessionStore(backend);

    /**
     * Runs the real session, answering each stage the way the screen answers it:
     * a timed stage by its own clock, a pose by a genuine unbroken hold in its own
     * shape. `skipPoses` instead lets the whole activity's time run out, which is
     * what happens to somebody whose first pose is never held.
     */
    function run(skipPoses: boolean): number {
      const clock = fakeClock();
      const session = new GuidedSession(activity, clock.now);
      session.start();
      if (skipPoses) {
        clock.advance(activity.durationSeconds);
        return session.snapshot().stepsCompleted;
      }
      let steps = 0;
      while (steps < activity.steps.length) {
        const before = session.snapshot();
        if (before.finished) break;
        const step = before.currentStep;
        if (step === null) break;
        if (step.poseRuleId === undefined) {
          clock.advance(step.seconds);
        } else {
          holdPose(step.poseRuleId, new YogaHoldTracker(getYogaPoseRule(step.poseRuleId)!), clock, () =>
            session.completeStep(session.snapshot().stepIndex),
          );
        }
        steps = session.snapshot().stepsCompleted;
      }
      return steps;
    }

    const firstPoseAt = activity.steps.findIndex((step) => step.poseRuleId !== undefined);
    const allHeld = run(false);
    const posesSkipped = run(true);

    check('holding every pose records every step', allHeld === activity.steps.length, `${allHeld}/${activity.steps.length}`);
    check('never holding a pose records only the stages before the first one', posesSkipped === firstPoseAt, `${posesSkipped} vs first pose at ${firstPoseAt}`);

    const now = new Date(2026, 8, 28, 14, 0, 0);
    const todayNoon = new Date(2026, 8, 28, 12, 0, 0).toISOString();

    for (const [id, stepsCompleted] of [['held', allHeld], ['unheld', posesSkipped]] as const) {
      await store.saveSession(
        createSessionRecord({
          id,
          exerciseId: activity.id,
          exerciseName: activity.name,
          completedAt: todayNoon,
          metrics,
          activityKind: activity.kind,
          stepsCompleted,
        }),
      );
    }

    const records = await store.getSessions();
    check('both sessions are stored', records.length === 2, records.map((entry) => entry.id));
    check('the honest run kept its full count', records.find((entry) => entry.id === 'held')?.stepsCompleted === activity.steps.length);
    check('and so did the run that never held a pose, truthfully', records.find((entry) => entry.id === 'unheld')?.stepsCompleted === firstPoseAt);

    const yoga = guidedCatalog('yoga');
    check('a routine with every pose held is done today', todayStatus(records, yoga, 'yoga', now).find((entry) => entry.activityId === activity.id)?.done === true);
  });

  suite('guided completion: a routine whose poses were never held is not done today', async () => {
    const activity = findGuidedActivity('chair-yoga-flow');
    check('a camera routine is in the catalogue', activity !== undefined);
    if (activity === undefined) return;

    const written = new Map<string, string>();
    const backend: KeyValueStore = {
      getItem: async (key) => written.get(key) ?? null,
      setItem: async (key, value) => {
        written.set(key, value);
      },
      removeItem: async (key) => {
        written.delete(key);
      },
    };
    const store = createSessionStore(backend);

    // Someone who stopped after the first stage of the routine.
    const clock = fakeClock();
    const session = new GuidedSession(activity, clock.now);
    session.start();
    clock.advance(activity.steps[0].seconds + 3);
    session.finishEarly();

    const record = createSessionRecord({
      id: 'partial',
      exerciseId: activity.id,
      exerciseName: activity.name,
      completedAt: new Date(2026, 8, 28, 12, 0, 0).toISOString(),
      metrics: buildSessionMetrics({ reps: 0, durationSeconds: 33, repRanges: [], rangeMinDeg: null, rangeMaxDeg: null }),
      activityKind: activity.kind,
      stepsCompleted: session.snapshot().stepsCompleted,
    });
    await store.saveSession(record);

    const records = await store.getSessions();
    const now = new Date(2026, 8, 28, 14, 0, 0);
    check('the partial count is what was stored', records[0]?.stepsCompleted === 1, records[0]?.stepsCompleted);
    check('and the routine is not done today', todayStatus(records, guidedCatalog('yoga'), 'yoga', now).find((entry) => entry.activityId === activity.id)?.done === false);
  });
}