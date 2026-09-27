import type { LandmarkEventPayload, PoseFrameEventPayload, PoseLandmarkName, PosePresence } from '../modules/pose-tracker';
import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { phaseFeedback, PositiveFeedbackLatch, priorityPhase, readinessFeedback } from '../src/exercise/feedback';
import { SessionEngine } from '../src/exercise/session-engine';
import type { Side } from '../src/exercise/types';

/**
 * End-to-end coverage of the per-frame pose pipeline, driving the real
 * SessionEngine with synthetic pose frames. These lock the ordering rules that
 * decide whether a rep may ever be counted: presence handling, readiness
 * gating, invalid-landmark rejection, and frame-timing robustness.
 *
 * Everything here is deterministic and device-free. None of it verifies the
 * camera, MediaPipe, or the native module.
 */

type XY = { x: number; y: number };

const SIDE_NAMES: Record<Side, { hip: PoseLandmarkName; knee: PoseLandmarkName; ankle: PoseLandmarkName }> = {
  left: { hip: 'LEFT_HIP', knee: 'LEFT_KNEE', ankle: 'LEFT_ANKLE' },
  right: { hip: 'RIGHT_HIP', knee: 'RIGHT_KNEE', ankle: 'RIGHT_ANKLE' },
};
const SIDE_GEOMETRY: Record<Side, { hip: XY; knee: XY }> = {
  left: { hip: { x: 0.46, y: 0.3 }, knee: { x: 0.46, y: 0.5 } },
  right: { hip: { x: 0.54, y: 0.3 }, knee: { x: 0.54, y: 0.5 } },
};

const BENT = 90;
const REST = 90;

function ankleFor(hip: XY, knee: XY, angleDeg: number): XY {
  const hdir = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const rad = hdir - (angleDeg * Math.PI) / 180;
  return { x: knee.x + Math.cos(rad) * 0.28, y: knee.y + Math.sin(rad) * 0.28 };
}

/** Synthetic seated pose with a chosen knee angle per side. */
function pose(
  leftAngle: number,
  rightAngle: number,
  opts: { visibility?: number; omit?: PoseLandmarkName[]; nan?: PoseLandmarkName[]; bodyY?: number } = {},
): LandmarkEventPayload[] {
  const visibility = opts.visibility ?? 1;
  const omit = new Set(opts.omit ?? []);
  const nan = new Set(opts.nan ?? []);
  // Shifts the whole body vertically without changing any joint angle, so a
  // posture change can be expressed as pure whole-body translation.
  const dy = opts.bodyY ?? 0;
  const landmarks: LandmarkEventPayload[] = [];

  for (const side of ['left', 'right'] as const) {
    const { hip, knee } = SIDE_GEOMETRY[side];
    const names = SIDE_NAMES[side];
    const ankle = ankleFor(hip, knee, side === 'left' ? leftAngle : rightAngle);
    for (const [name, point] of [[names.hip, hip], [names.knee, knee], [names.ankle, ankle]] as const) {
      if (omit.has(name)) continue;
      const broken = nan.has(name);
      landmarks.push({
        name,
        x: broken ? Number.NaN : point.x,
        y: broken ? Number.NaN : point.y + dy,
        z: 0,
        visibility,
      });
    }
  }
  return landmarks;
}

function frame(
  landmarks: LandmarkEventPayload[],
  timestampMs: number,
  presence: PosePresence = 'tracked',
): { nativeEvent: PoseFrameEventPayload } {
  return { nativeEvent: { timestampMs, presence, landmarks } as PoseFrameEventPayload };
}

/** One full rep on the left leg at a 100ms cadence; the right leg stays bent. */
const REP_CADENCE = [120, 150, 170, 170, 130, 110, REST, REST];

/**
 * Feeds still frames until the readiness gate grants counting. The gate needs
 * minStableFrames=10 consecutive calm frames spanning minStableMs=1000, so this
 * is comfortably past the boundary.
 */
function reachReady(engine: SessionEngine, startMs = 0): number {
  let t = startMs;
  for (let i = 0; i < 14; i++) {
    engine.handlePoseFrame(frame(pose(REST, REST), t));
    t += 100;
  }
  return t;
}

/** Drives a left-leg rep and returns the timestamp after it. */
function doLeftRep(engine: SessionEngine, startMs: number): number {
  let t = startMs;
  for (const angle of REP_CADENCE) {
    engine.handlePoseFrame(frame(pose(angle, REST), t));
    t += 100;
  }
  return t;
}

/** A motionless, already-straight leg: the posture that armed the bug. */
const STRAIGHT = 176;
/** Total knee sweep produced by lowering into a chair. */
const SIT_SWEEP = STRAIGHT - REST;

export function run(): void {
  suite('pipeline: readiness gate must be earned before any rep', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    check('starts in waiting', engine.readinessPhase === 'waiting');
    check('starts with zero reps', engine.reps === 0);

    // A full rep played immediately must count nothing: the gate has not settled.
    for (const angle of REP_CADENCE) engine.handlePoseFrame(frame(pose(angle, REST), 0));
    check('rep before readiness is not counted', engine.reps === 0);
    check('gate still waiting', engine.readinessPhase === 'waiting');
  });

  suite('pipeline: a clean rep after readiness counts exactly once', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    check('gate is ready', engine.readinessPhase === 'ready');
    doLeftRep(engine, t);
    check('exactly one rep', engine.reps === 1);
    const range = engine.observedRange;
    check('observed range recorded', range !== null && range.min <= BENT && range.max >= 170);
  });

  suite('pipeline A: presence lost mid-rep never completes it', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    // Extend, then lose the person before the leg comes back down.
    for (const angle of [120, 150, 170, 170]) {
      engine.handlePoseFrame(frame(pose(angle, REST), t));
      t += 100;
    }
    const lost = engine.handlePoseFrame(frame(pose(170, REST), t, 'lost'));
    t += 100;
    check('loss reports zero reps', lost.reps === 0);
    check('loss asks the user to return', lost.feedback.text === 'Move into the camera view');
    check('gate drops to waiting on loss', engine.readinessPhase === 'waiting');

    for (const angle of [REST, REST, REST, REST]) {
      engine.handlePoseFrame(frame(pose(angle, REST), t));
      t += 100;
    }
    check('returning frames still count no rep', engine.reps === 0);
    check('gate is re-acquiring, not ready', engine.readinessPhase !== 'ready');
  });

  suite('pipeline I: returning after a loss must re-earn readiness', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    doLeftRep(engine, t);
    check('first rep counted', engine.reps === 1);

    engine.handlePoseFrame(frame(pose(REST, REST), t, 'lost'));
    t += 100;
    // Immediately attempt another rep on return: must NOT count.
    t = doLeftRep(engine, t);
    check('rep immediately after a loss is not counted', engine.reps === 1);

    // Settle again, then a full rep counts.
    reachReady(engine, t);
    check('gate ready again after settling', engine.readinessPhase === 'ready');
    doLeftRep(engine, t + 1500);
    check('recovered session counts again', engine.reps === 2);
  });

  suite('pipeline B/C/D: invalid or invisible landmarks never count a rep', () => {
    const cases: { name: string; opts: Parameters<typeof pose>[2] }[] = [
      { name: 'missing left ankle', opts: { omit: ['LEFT_ANKLE'] } },
      { name: 'missing right knee', opts: { omit: ['RIGHT_KNEE'] } },
      { name: 'missing both hips', opts: { omit: ['LEFT_HIP', 'RIGHT_HIP'] } },
      { name: 'NaN left ankle', opts: { nan: ['LEFT_ANKLE'] } },
      { name: 'NaN right hip', opts: { nan: ['RIGHT_HIP'] } },
    ];

    for (const testCase of cases) {
      const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
      let t = reachReady(engine);
      check(`${testCase.name}: gate ready first`, engine.readinessPhase === 'ready');

      // A full rep where every frame carries the defect.
      for (const angle of REP_CADENCE) {
        engine.handlePoseFrame(frame(pose(angle, REST, testCase.opts), t));
        t += 100;
      }
      check(`${testCase.name}: no rep counted`, engine.reps === 0);
      check(`${testCase.name}: gate suspended`, engine.readinessPhase === 'waiting');
    }

    // Low visibility: below minVisibility (0.4) the joints are unusable.
    const dim = new SessionEngine(SEATED_KNEE_EXTENSION);
    let dt = reachReady(dim);
    check('low-visibility: gate ready first', dim.readinessPhase === 'ready');
    for (const angle of REP_CADENCE) {
      dim.handlePoseFrame(frame(pose(angle, REST, { visibility: 0.1 }), dt));
      dt += 100;
    }
    check('low visibility never counts a rep', dim.reps === 0);

    // A single corrupt frame in the middle of a real rep must not break it.
    const glitch = new SessionEngine(SEATED_KNEE_EXTENSION);
    let gt = reachReady(glitch);
    for (const angle of REP_CADENCE) {
      glitch.handlePoseFrame(frame(pose(angle, REST, gt % 200 === 0 ? { nan: ['LEFT_ANKLE'] } : {}), gt));
      gt += 100;
    }
    check('a NaN frame mid-rep prevents that rep', glitch.reps === 0);
  });

  suite('pipeline G: a tracking stall cannot join frames into a rep', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    // Extend, then stall for 30s, then lower the leg.
    for (const angle of [120, 150, 170, 170]) {
      engine.handlePoseFrame(frame(pose(angle, REST), t));
      t += 100;
    }
    check('nothing counted mid-extension', engine.reps === 0);

    t += 30_000;
    for (const angle of [REST, REST, REST, REST]) {
      engine.handlePoseFrame(frame(pose(angle, REST), t));
      t += 100;
    }
    check('rep spanning a 30s stall is not counted', engine.reps === 0);
  });

  suite('pipeline G: a stall inside the allowed window still counts', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    // ~300ms between frames is well inside maxFrameGapMs (1000): still one rep.
    for (const angle of REP_CADENCE) {
      engine.handlePoseFrame(frame(pose(angle, REST), t));
      t += 300;
    }
    check('slow-but-continuous rep is still counted', engine.reps === 1);
  });

  suite('pipeline F: duplicated and out-of-order timestamps cannot inflate reps', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    // Replay the same rep several times on identical / backwards timestamps.
    for (let replay = 0; replay < 4; replay++) {
      for (const angle of [...REP_CADENCE, ...REP_CADENCE, ...REP_CADENCE]) {
        engine.handlePoseFrame(frame(pose(angle, REST), t));
      }
      t += 10;
    }
    check('repeated identical timestamps add at most one rep', engine.reps <= 1);

    // Strictly decreasing timestamps must never count anything either.
    const backwards = new SessionEngine(SEATED_KNEE_EXTENSION);
    let bt = reachReady(backwards);
    for (const angle of [...REP_CADENCE, ...REP_CADENCE, ...REP_CADENCE]) {
      bt -= 100;
      backwards.handlePoseFrame(frame(pose(angle, REST), bt));
    }
    check('backwards timestamps count nothing', backwards.reps === 0);
  });

  suite('pipeline E: very rapid frames cannot skip the hold requirement', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    const t = reachReady(engine);
    // 120 identical timestamps in 1ms: holdFrames must still be enforced.
    for (let i = 0; i < 120; i++) {
      engine.handlePoseFrame(frame(pose(170, REST), t + 1));
    }
    check('held extension alone counts nothing', engine.reps === 0);
    for (let i = 0; i < 2; i++) engine.handlePoseFrame(frame(pose(REST, REST), t + 2));
    check('one frame of return is not enough', engine.reps === 0);
  });

  suite('lifecycle: reset gives a clean session, end freezes the totals', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    doLeftRep(engine, t);
    doLeftRep(engine, t + 1000);
    check('two reps before reset', engine.reps === 2);

    engine.reset();
    check('reset clears reps', engine.reps === 0);
    check('reset clears ranges', engine.repRanges.length === 0);
    check('reset clears observed range', engine.observedRange === null);
    check('reset returns gate to waiting', engine.readinessPhase === 'waiting');

    t = reachReady(engine, 100_000);
    doLeftRep(engine, t);
    check('fresh session counts from zero', engine.reps === 1);

    engine.end();
    check('end preserves the final rep count', engine.reps === 1);
    // Frames still arriving after end must not add anything.
    t = doLeftRep(engine, t + 1000);
    check('frames after end do not revive counting', engine.reps === 1);
    check('engine stays ready-phase but frozen', engine.readinessPhase === 'ready');
  });

  suite('lifecycle: pause freezes the partial cycle but resume still counts', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    doLeftRep(engine, t);
    check('one rep before pause', engine.reps === 1);

    // Pause mid-way through the NEXT rep's extension.
    t += 1000;
    for (const angle of [120, 150, 170, 170]) {
      engine.handlePoseFrame(frame(pose(angle, REST), t));
      t += 100;
    }
    const paused = engine.pause();
    check('pause preserves counted reps', paused.reps === 1);
    check('pause says so in the HUD', paused.feedback.text === 'Paused');

    // The frames that would have lowered the leg are never fed while paused (the
    // session screen drops them), so on resume the cycle is gone: the machine
    // must start the next rep from scratch. If the interrupted cycle were still
    // alive, the total would jump to 3 (the interrupted one plus the new one).
    doLeftRep(engine, t + 5000);
    check('resumed session counts exactly the one new rep', engine.reps === 2);
  });

  suite('feedback: the positive cue persists until the legs move again', () => {
    const latch = new PositiveFeedbackLatch();
    // A rep completes with both legs at rest.
    check('latches on the completing frame', latch.observe('rest', true) === true);
    check('stays latched while still at rest', latch.observe('rest', false) === true);
    check('still latched on the next rest frame', latch.observe('rest', false) === true);
    // The legs start moving again: the praise is over.
    check('releases when a leg starts extending', latch.observe('extending', false) === false);
    check('stays released while extending', latch.observe('extending', false) === false);
    // A second rep latches again.
    check('re-latches on the next completed rep', latch.observe('rest', true) === true);

    latch.clear();
    check('clear releases immediately', latch.observe('rest', false) === false);
  });

  suite('feedback: selection is stable and non-flickering', () => {
    // Repeated identical input must produce an identical cue object value, so
    // the HUD dedup guard can suppress redundant renders.
    const a = phaseFeedback('extending', false);
    const b = phaseFeedback('extending', false);
    check('same phase yields the same text', a.text === b.text);
    check('same phase yields the same tone', a.tone === b.tone);

    check('rest reads as ready', phaseFeedback('rest', false).text === 'Ready');
    check('extending instructs', phaseFeedback('extending', false).text === 'Extend your knee');
    check('extended confirms', phaseFeedback('extended', false).text === 'Keep it straight');
    check('returning instructs', phaseFeedback('returning', false).text === 'Return slowly');
    check('completion praises', phaseFeedback('rest', true).text === 'Good movement');
    check('praise tone is positive', phaseFeedback('rest', true).tone === 'sage');

    check('waiting asks for position', readinessFeedback('waiting').text === 'Get into position');
    check('stabilizing asks for stillness', readinessFeedback('stabilizing').text === 'Get ready');
    check('ready confirms', readinessFeedback('ready').text === 'Ready');
  });

  suite('feedback: merged leg phase prefers the active instruction', () => {
    check('returning beats everything', priorityPhase('rest', 'returning') === 'returning');
    check('extending beats extended', priorityPhase('extended', 'extending') === 'extending');
    check('extended beats rest', priorityPhase('rest', 'extended') === 'extended');
    check('both resting is rest', priorityPhase('rest', 'rest') === 'rest');
  });

  /* ------------------------------------------------------------------------ *
   * Regression: "sitting in the chair counted a rep" (physical device).
   *
   * Pressing Start while standing beside the chair and then sitting down is a
   * full rep-shaped cycle: the knee sweeps ~176deg to ~90deg while the hips
   * translate 0.22. Before the starting-posture precondition this counted a rep
   * of range 53.7deg at every sitting speed, because the absolute angle bands
   * let a motionless straight leg walk the machine to `extended` on its own and
   * the subsequent lowering then supplied the `returning` half.
   * ------------------------------------------------------------------------ */

  /** Lowers into a chair over `sitFrames`, hips descending by `hipTravel`. */
  function sitDown(
    engine: SessionEngine,
    startMs: number,
    sitFrames: number,
    hipTravel: number,
  ): number {
    let t = startMs;
    for (let i = 1; i <= sitFrames; i++) {
      const k = i / sitFrames;
      const angle = STRAIGHT - SIT_SWEEP * k;
      engine.handlePoseFrame(frame(pose(angle, angle, { bodyY: hipTravel * k }), t));
      t += 100;
    }
    return t;
  }

  suite('pipeline: sitting down after Start is never counted as a rep', () => {
    // The gate arms while the person is standing still, which is correct: they
    // are valid, visible and motionless. Nothing may be counted from that.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(STRAIGHT, STRAIGHT), t));
      t += 100;
    }
    check('the gate armed while standing still', engine.readinessPhase === 'ready', engine.readinessPhase);
    check('standing motionless counts nothing', engine.reps === 0, engine.reps);

    t = sitDown(engine, t, 8, 0.22);
    check('lowering into the chair counts nothing', engine.reps === 0, engine.reps);
    check(
      'the gate did independently notice the relocation',
      engine.readinessPhase !== 'ready',
      engine.readinessPhase,
    );

    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(REST, REST), t));
      t += 100;
    }
    check('seated and still counts nothing', engine.reps === 0, engine.reps);
  });

  suite('pipeline: sitting down counts nothing at any speed', () => {
    // The pre-fix failure was speed-independent: the rep completed while the hip
    // anchor was still inside maxAnchorOffset, so every cadence failed the same
    // way. Lock all of them down.
    for (const sitFrames of [6, 10, 16, 25, 40, 80]) {
      const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
      let t = 0;
      for (let i = 0; i < 14; i++) {
        engine.handlePoseFrame(frame(pose(STRAIGHT, STRAIGHT), t));
        t += 100;
      }
      t = sitDown(engine, t, sitFrames, 0.22);
      for (let i = 0; i < 14; i++) {
        engine.handlePoseFrame(frame(pose(REST, REST), t));
        t += 100;
      }
      check(`sitting down over ${sitFrames} frames counts nothing`, engine.reps === 0, engine.reps);
    }
  });

  suite('pipeline: standing up and sitting back down is not a rep', () => {
    // The mirror case. The descent that follows a real stand-up is the same
    // motion that failed above, and must be rejected for the same reason.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine);
    check('armed while seated', engine.readinessPhase === 'ready', engine.readinessPhase);

    // Stand up: hips rise 0.22 and the knee straightens.
    for (let i = 1; i <= 10; i++) {
      const k = i / 10;
      engine.handlePoseFrame(
        frame(pose(REST + SIT_SWEEP * k, REST + SIT_SWEEP * k, { bodyY: -0.22 * k }), t),
      );
      t += 100;
    }
    check('standing up counts nothing', engine.reps === 0, engine.reps);

    // ...and sit back down again.
    t = sitDown(engine, t, 10, 0.22);
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(REST, REST), t));
      t += 100;
    }
    check('and sitting back down still counts nothing', engine.reps === 0, engine.reps);
  });

  suite('pipeline: legs already outstretched at Start cannot settle into a rep', () => {
    // Same defect without any body translation: a person who starts the session
    // with their legs out has a resting angle inside the "extended" band, and
    // any settling dip used to complete a rep.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(172, 172), t));
      t += 100;
    }
    check('the gate armed with the legs outstretched', engine.readinessPhase === 'ready', engine.readinessPhase);

    // The ankle relaxing as they settle: dips below the bent band and comes back.
    for (let i = 0; i < 30; i++) {
      const angle = 172 - (i % 6 < 3 ? 34 : 0);
      engine.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('settling never completes a rep', engine.reps === 0, engine.reps);
  });

  suite('pipeline: a real rep still counts after all of that', () => {
    // The precondition must not cost a single genuine repetition.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    // Sit down first, from standing, exactly as the bug report describes.
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(STRAIGHT, STRAIGHT), t));
      t += 100;
    }
    t = sitDown(engine, t, 10, 0.22);
    t = reachReady(engine, t);
    check('ready after sitting down', engine.readinessPhase === 'ready', engine.readinessPhase);
    check('still nothing counted', engine.reps === 0, engine.reps);

    t = doLeftRep(engine, t);
    check('the first real rep counts', engine.reps === 1, engine.reps);

    t += 1500;
    t = doLeftRep(engine, t);
    check('and so does the next', engine.reps === 2, engine.reps);
  });
}
