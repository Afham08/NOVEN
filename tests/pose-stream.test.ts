import type { LandmarkEventPayload, PoseFrameEventPayload, PoseLandmarkName, PosePresence } from '../modules/pose-tracker';
import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { phaseFeedback, PositiveFeedbackLatch, priorityPhase, readinessFeedback } from '../src/exercise/feedback';
import { SIT_TO_STAND } from '../src/exercise/pose-configs';
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
  opts: {
    visibility?: number;
    rightVisibility?: number;
    presence?: number;
    rightPresence?: number;
    omit?: PoseLandmarkName[];
    nan?: PoseLandmarkName[];
    bodyY?: number;
  } = {},
): LandmarkEventPayload[] {
  const visibility = opts.visibility ?? 1;
  const presence = opts.presence ?? 1;
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
    // Per-side scores let a test dim or zero exactly one side, which is how
    // "the far leg is unreadable, the near leg is observed" is expressed.
    // Visibility is what decides readability; presence is carried only so a
    // test can prove it no longer gates anything.
    const sideVisibility = side === 'right' ? (opts.rightVisibility ?? visibility) : visibility;
    const sidePresence = side === 'right' ? (opts.rightPresence ?? presence) : presence;
    for (const [name, point] of [[names.hip, hip], [names.knee, knee], [names.ankle, ankle]] as const) {
      if (omit.has(name)) continue;
      const broken = nan.has(name);
      landmarks.push({
        name,
        x: broken ? Number.NaN : point.x,
        y: broken ? Number.NaN : point.y + dy,
        z: 0,
        visibility: sideVisibility,
        presence: sidePresence,
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
    // Only a defect that makes EVERY side unusable can suspend the gate. With
    // nothing trustworthy there is no geometry left to measure, so this stays
    // all-or-nothing exactly as before.
    const cases: { name: string; opts: Parameters<typeof pose>[2] }[] = [
      { name: 'missing both hips', opts: { omit: ['LEFT_HIP', 'RIGHT_HIP'] } },
      { name: 'missing both ankles', opts: { omit: ['LEFT_ANKLE', 'RIGHT_ANKLE'] } },
      { name: 'NaN both knees', opts: { nan: ['LEFT_KNEE', 'RIGHT_KNEE'] } },
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

    // Low visibility: below minVisibility (0.4) the joints are unusable. Both
    // sides are dim at once, so no side is trustworthy and counting stops.
    const dim = new SessionEngine(SEATED_KNEE_EXTENSION);
    let dt = reachReady(dim);
    check('low-visibility: gate ready first', dim.readinessPhase === 'ready');
    for (const angle of REP_CADENCE) {
      dim.handlePoseFrame(frame(pose(angle, REST, { visibility: 0.1 }), dt));
      dt += 100;
    }
    check('low visibility never counts a rep', dim.reps === 0);
    check('low visibility suspends counting', dim.readinessPhase === 'waiting');

    // A single corrupt frame in the middle of a real rep must not break it.
    const glitch = new SessionEngine(SEATED_KNEE_EXTENSION);
    let gt = reachReady(glitch);
    for (const angle of REP_CADENCE) {
      glitch.handlePoseFrame(frame(pose(angle, REST, gt % 200 === 0 ? { nan: ['LEFT_ANKLE'] } : {}), gt));
      gt += 1 * 100;
    }
    check('a NaN frame mid-rep prevents that rep', glitch.reps === 0);
  });

  suite('pipeline: an unreadable far side cannot veto a readable near side', () => {
    // The far leg is hidden behind the near leg in a side view, so MediaPipe
    // reports it as inferred rather than observed. That is the normal case, and
    // it must neither suspend the gate nor block the near side's rep.
    const farSideDefects: { name: string; opts: Parameters<typeof pose>[2] }[] = [
      { name: 'missing far ankle', opts: { omit: ['RIGHT_ANKLE'] } },
      { name: 'missing far knee', opts: { omit: ['RIGHT_KNEE'] } },
      { name: 'NaN far hip', opts: { nan: ['RIGHT_HIP'] } },
      { name: 'missing far hip', opts: { omit: ['RIGHT_HIP'] } },
    ];

    for (const testCase of farSideDefects) {
      const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
      let t = reachReady(engine);
      check(`${testCase.name}: gate ready first`, engine.readinessPhase === 'ready');

      // A full left-leg rep while the far side stays unreadable throughout.
      for (const angle of REP_CADENCE) {
        engine.handlePoseFrame(frame(pose(angle, REST, testCase.opts), t));
        t += 100;
      }
      check(`${testCase.name}: near-side rep still counts`, engine.reps === 1);
      check(`${testCase.name}: gate stays ready`, engine.readinessPhase === 'ready');
    }

    // The mirror image: the NEAR side is the broken one. Readiness survives on
    // the far side, but the broken side's own angle is unusable, so its rep
    // cannot be counted and nothing is invented from the missing joint.
    const nearBroken = new SessionEngine(SEATED_KNEE_EXTENSION);
    let nt = reachReady(nearBroken);
    for (const angle of REP_CADENCE) {
      nearBroken.handlePoseFrame(frame(pose(angle, REST, { omit: ['LEFT_ANKLE'] }), nt));
      nt += 100;
    }
    check('near-side defect: no rep from the unusable leg', nearBroken.reps === 0);
    check('near-side defect: far side still keeps the gate ready', nearBroken.readinessPhase === 'ready');

    // Presence is TELEMETRY, not a trust criterion. The bundled model emits one
    // pose-level `output_poseflag` tensor that MediaPipe broadcasts into every
    // landmark, so on a real device a correctly framed subject reported presence
    // 0.00 on every landmark while visibility was healthy and the knee geometry
    // was valid. Gating on it suspended counting for 34 of 34 captured samples.
    // Low visibility (see the `dim` case above) is the signal that actually means
    // "the model is inferring this limb".
    const presenceZero = new SessionEngine(SEATED_KNEE_EXTENSION);
    let pzt = reachReady(presenceZero);
    for (const angle of REP_CADENCE) {
      presenceZero.handlePoseFrame(frame(pose(angle, REST, { presence: 0 }), pzt));
      pzt += 100;
    }
    check('presence 0 throughout still counts the rep', presenceZero.reps === 1, `reps=${presenceZero.reps}`);
    check('presence 0 throughout leaves counting running', presenceZero.readinessPhase === 'ready', presenceZero.readinessPhase);

    // ...and the same holds when only one side reports presence 0.
    const oneSidePresenceZero = new SessionEngine(SEATED_KNEE_EXTENSION);
    let opzt = reachReady(oneSidePresenceZero);
    for (const angle of REP_CADENCE) {
      oneSidePresenceZero.handlePoseFrame(frame(pose(angle, REST, { rightPresence: 0 }), opzt));
      opzt += 100;
    }
    check('one side at presence 0: near-side rep still counts', oneSidePresenceZero.reps === 1, `reps=${oneSidePresenceZero.reps}`);
    check('one side at presence 0: gate stays ready', oneSidePresenceZero.readinessPhase === 'ready', oneSidePresenceZero.readinessPhase);
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
    // The knee wording is tied to the movement it describes, not to the phase.
    check(
      'extending instructs, for the knee movement',
      phaseFeedback('extending', false, 'seated-knee-extension').text === 'Extend your knee',
    );
    check(
      'extended confirms, for the knee movement',
      phaseFeedback('extended', false, 'seated-knee-extension').text === 'Keep it straight',
    );
    check(
      'returning instructs, for the knee movement',
      phaseFeedback('returning', false, 'seated-knee-extension').text === 'Return slowly',
    );
    check('completion praises', phaseFeedback('rest', true).text === 'Good movement');
    check('praise tone is positive', phaseFeedback('rest', true).tone === 'sage');

    check('waiting asks for position', readinessFeedback('waiting').text === 'Get into position');
    check('stabilizing asks for stillness', readinessFeedback('stabilizing').text === 'Get ready');
    check('ready confirms', readinessFeedback('ready').text === 'Ready');
  });

  /**
   * Drives one full out-and-back cycle and records what the HUD was told.
   * Returns the distinct texts in the order they first appeared.
   */
  function coachingFor(config: typeof SEATED_KNEE_EXTENSION): string[] {
    const engine = new SessionEngine(config);
    let t = reachReady(engine);
    const seen: string[] = [];
    for (const angle of [120, 140, 160, 176, 176, 160, 140, 120, REST, REST]) {
      const out = engine.handlePoseFrame(frame(pose(angle, angle), t));
      if (!seen.includes(out.feedback.text)) seen.push(out.feedback.text);
      t += 100;
    }
    return seen;
  }

  suite('feedback: the engine words the cue for the movement it was built with', () => {
    /*
     * The wording lookup is only worth anything if the movement actually reaches
     * it. Two engines are driven with byte-identical synthetic frames and differ
     * only in their config, which is exactly the substitution the guided screen
     * makes when it resolves a step's cameraConfigId.
     */
    const knee = coachingFor(SEATED_KNEE_EXTENSION);
    const stand = coachingFor(SIT_TO_STAND);

    check('the knee engine coaches the knee', knee.includes('Extend your knee'), knee);
    check('the knee engine says to keep it straight', knee.includes('Keep it straight'), knee);

    for (const phrase of ['Extend your knee', 'Keep it straight', 'Return slowly']) {
      check(`a sit-to-stand session never says "${phrase}"`, !stand.includes(phrase), stand);
    }
    check('the sit-to-stand engine coaches standing up', stand.includes('Stand up slowly'), stand);

    // Movement wording changed; rep counting and praise did not.
    check('the knee session still finishes on a counted rep', knee.includes('Good movement'), knee);
    check('the sit-to-stand session still finishes on a counted rep', stand.includes('Good movement'), stand);

    for (const text of [...knee, ...stand]) {
      check(`"${text}" is a short phrase`, text.length > 0 && text.length <= 24, text);
    }
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

  /** Rises out of a chair over `standFrames`, hips lifting by `hipTravel`. */
  function standUp(
    engine: SessionEngine,
    startMs: number,
    standFrames: number,
    hipTravel: number,
  ): number {
    let t = startMs;
    for (let i = 1; i <= standFrames; i++) {
      const k = i / standFrames;
      const angle = REST + SIT_SWEEP * k;
      engine.handlePoseFrame(frame(pose(angle, angle, { bodyY: -hipTravel * k }), t));
      t += 100;
    }
    return t;
  }

  /**
   * The exact reverse of `standUp`: lowers from a lifted `hipTravel` back to the
   * seated baseline, rather than the downward-only `sitDown` (which starts from
   * the baseline). Sign matters for the *motion* even though the readiness gate
   * measures a magnitude, because the offset has to fall monotonically for this
   * to be a single continuous descent.
   */
  function sitBackDown(
    engine: SessionEngine,
    startMs: number,
    sitFrames: number,
    liftedHipTravel: number,
  ): number {
    let t = startMs;
    for (let i = 1; i <= sitFrames; i++) {
      const k = i / sitFrames;
      const angle = STRAIGHT - SIT_SWEEP * k;
      engine.handlePoseFrame(
        frame(pose(angle, angle, { bodyY: -liftedHipTravel * (1 - k) }), t),
      );
      t += 100;
    }
    return t;
  }

  suite('pipeline: sitting down after Start is never counted as a rep', () => {
    // Stronger than the original expectation: the gate must not arm AT ALL while
    // the person is standing. A straight leg is outside this exercise's rest
    // regime, so counting is never enabled in the first place — the detectors
    // never see the sit-down.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(STRAIGHT, STRAIGHT), t));
      t += 100;
    }
    check('the gate refuses to arm while standing', engine.readinessPhase !== 'ready', engine.readinessPhase);
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
    // Now genuinely seated in the starting posture, counting may begin.
    check('and the gate arms once seated', engine.readinessPhase === 'ready', engine.readinessPhase);
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
    t = standUp(engine, t, 10, 0.22);
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
    check('the gate refuses to arm with the legs outstretched', engine.readinessPhase !== 'ready', engine.readinessPhase);

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

  // ---------------------------------------------------------------------------
  // The "counted a rep while simply STANDING" report.
  //
  // A rep is scored purely from ABSOLUTE knee-angle bands, so anything that
  // carries a knee from bent to straight and back to bent looks like a rep. That
  // is safe only while the person is in the posture the exercise is defined
  // from. The stillness gate could not enforce that: standing is motionless and
  // hip-stable, so it granted counting to someone with a ~176deg leg, and an
  // ordinary standing weight shift (bend, straighten, bend) was scored.
  //
  // These lock in both halves of the repair: STANDING can never count, and
  // SEATED still counts every genuine repetition.
  // ---------------------------------------------------------------------------

  /** A plausible standing weight shift, repeated. Both legs move, as they do in
   * the side view this app uses. The dips stay shallow - 130deg is a real bend,
   * but not a seated knee extension. */
  const SHIFT_DIP = 130;
  const SHIFT_PEAK = 176;

  /** Feeds `cycles` weight-shift cycles (dip, straighten, dip) and returns t. */
  function shiftWeight(engine: SessionEngine, startMs: number, cycles = 3, dip = SHIFT_DIP): number {
    let t = startMs;
    for (let c = 0; c < cycles; c++) {
      for (const angle of [dip, SHIFT_PEAK, dip, SHIFT_PEAK, dip]) {
        for (let k = 0; k < 4; k++) {
          engine.handlePoseFrame(frame(pose(angle, angle), t));
          t += 100;
        }
      }
      t += 900;
    }
    return t;
  }

  /** Feeds `seconds` of motionless standing. */
  function stand(engine: SessionEngine, startMs: number, seconds = 3): number {
    let t = startMs;
    for (let i = 0; i < seconds * 10; i++) {
      engine.handlePoseFrame(frame(pose(SHIFT_PEAK, SHIFT_PEAK), t));
      t += 100;
    }
    return t;
  }

  suite('standing must never count a rep (1: static standing)', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    stand(engine, 0, 30);
    check('60s of motionless standing counts nothing', engine.reps === 0, engine.reps);
    check('and the gate never granted counting', engine.readinessPhase !== 'ready', engine.readinessPhase);
  });

  suite('standing must never count a rep (2: standing with realistic jitter)', () => {
    // Real trackers never return a perfectly constant angle. Jitter alone must
    // not manufacture a range, and must not manufacture a rep.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    // Deterministic pseudo-noise, ±2deg, no Math.random so the test is stable.
    let seed = 7;
    const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 4;
    for (let i = 0; i < 300; i++) {
      const a = SHIFT_PEAK + next();
      engine.handlePoseFrame(frame(pose(a, a), t));
      t += 100;
    }
    check('30s of noisy standing counts nothing', engine.reps === 0, engine.reps);
  });

  suite('standing must never count a rep (3: standing posture changes)', () => {
    // Slowly leaning, shifting weight hip to hip, and swaying, without ever
    // sitting. Small hip motion must not be mistaken for a knee extension.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 120; i++) {
      const sway = Math.sin(i / 9) * 0.05;
      const a = SHIFT_PEAK - Math.abs(Math.sin(i / 14)) * 3;
      engine.handlePoseFrame(frame(pose(a, a, { bodyY: sway }), t));
      t += 100;
    }
    check('12s of standing sway counts nothing', engine.reps === 0, engine.reps);
  });

  suite('standing must never count a rep (4: session started while standing)', () => {
    // The reported scenario verbatim: Start, stand still, move around, and a rep
    // appears anyway.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = stand(engine, 0, 4);
    check('the gate refuses to arm on a straight leg', engine.readinessPhase !== 'ready', engine.readinessPhase);
    t = shiftWeight(engine, t, 3);
    check('weight shifts while standing count nothing', engine.reps === 0, engine.reps);
  });

  suite('standing must never count a rep (5: stand, then sit, then shift)', () => {
    // Sitting down must not retroactively admit the standing movement that
    // preceded it, nor may the shift that follows the sit be counted.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = stand(engine, 0, 4);
    t = shiftWeight(engine, t, 2);
    check('no rep before sitting', engine.reps === 0, engine.reps);
    t = sitDown(engine, t, 10, 0.22);
    check('no rep while sitting down', engine.reps === 0, engine.reps);
    t = shiftWeight(engine, t, 2);
    check('no rep from shifting after sitting', engine.reps === 0, engine.reps);
  });

  suite('standing must never count a rep (6: a genuine seated rep still counts)', () => {
    // The load-bearing counter-test. The posture gate must not reject the
    // exercise it exists to protect.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    check('the gate arms from the seated posture', engine.readinessPhase === 'ready', engine.readinessPhase);
    t = doLeftRep(engine, t);
    check('a real seated rep counts', engine.reps === 1, engine.reps);
  });

  suite('standing must never count a rep (7: repeated seated reps)', () => {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    for (let i = 1; i <= 5; i++) {
      t = doLeftRep(engine, t);
      t += 1500;
      check(`rep ${i} counted`, engine.reps === i, engine.reps);
    }
  });

  suite('standing must never count a rep (8: one bad side must not block counting)', () => {
    // The posture check accepts AT LEAST ONE side being in the rest regime,
    // because in the side view the far leg is model-inferred and can read
    // straighter than it really is. Requiring every side would let one bad
    // inference suppress counting permanently — trading an occasional false rep
    // for permanently missed reps.
    //
    // So the near leg is seated/bent and the far leg is valid but reads STRAIGHT
    // (the mis-inference this tolerance exists for). Counting must still arm and
    // a real rep must still count.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(REST, SHIFT_PEAK), t));
      t += 100;
    }
    // With both sides trustworthy and posture in disagreement, readiness must not
    // be granted (standing + seated must never be accepted as the initial seated
    // starting posture).
    check('disagreeing trustworthy postures must not grant readiness', engine.readinessPhase !== 'ready', engine.readinessPhase);

    // A genuine rep cannot be counted if we never became ready.
    t = doLeftRep(engine, t);
    check('no rep counted without readiness', engine.reps === 0, engine.reps);

    // Control: the tolerance must not become a hole in the other direction. When
    // BOTH sides read straight the posture is standing, and the gate must refuse
    // regardless of which side is nominally the "near" one.
    const standing = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = 0;
    for (let i = 0; i < 14; i++) {
      standing.handlePoseFrame(frame(pose(SHIFT_PEAK, SHIFT_PEAK), t));
      t += 100;
    }
    check('both sides straight is still refused', standing.readinessPhase !== 'ready', standing.readinessPhase);
  });

  suite('standing must never count a rep (9: tracking loss mid-shift)', () => {
    // Losing the pose during the extended half must not complete a rep, and
    // must not leave the gate armed on stale geometry.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (const angle of [SHIFT_DIP, SHIFT_PEAK, SHIFT_DIP]) {
      for (let k = 0; k < 4; k++) {
        engine.handlePoseFrame(frame(pose(angle, angle), t));
        t += 100;
      }
    }
    for (let k = 0; k < 6; k++) {
      engine.handlePoseFrame(frame(pose(SHIFT_PEAK, SHIFT_PEAK), t, 'lost'));
      t += 100;
    }
    for (let k = 0; k < 8; k++) {
      engine.handlePoseFrame(frame(pose(SHIFT_DIP, SHIFT_DIP), t));
      t += 100;
    }
    check('a shift broken by tracking loss counts nothing', engine.reps === 0, engine.reps);
  });

  suite('standing must never count a rep (10: pause and resume while standing)', () => {
    // Pausing freezes the detector but must not leave a standing shift able to
    // complete across the pause boundary.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(engine, 0);
    for (let k = 0; k < 4; k++) {
      engine.handlePoseFrame(frame(pose(SHIFT_DIP, SHIFT_DIP), t));
      t += 100;
    }
    engine.pause();
    t += 2000;
    for (let k = 0; k < 4; k++) {
      engine.handlePoseFrame(frame(pose(SHIFT_PEAK, SHIFT_PEAK), t));
      t += 100;
    }
    for (let k = 0; k < 4; k++) {
      engine.handlePoseFrame(frame(pose(SHIFT_DIP, SHIFT_DIP), t));
      t += 100;
    }
    check('a shift spanning a pause counts nothing', engine.reps === 0, engine.reps);
  });

  suite('pipeline: how much hip travel is needed to disarm counting', () => {
    // ---------------------------------------------------------------------
    // `maxAnchorOffset` is the ONLY defence left once a rep is under way, and
    // these tests pin exactly where that boundary sits.
    //
    // The resting-posture check is a one-time precondition evaluated at the
    // instant readiness is granted. By the time the knees have straightened the
    // person is mid-rep, and a genuine seated rep passes through exactly the
    // same "both legs straight, hips barely moved" geometry as a low-travel
    // stand-up — so no state or lifecycle signal can separate the two. A
    // disarm-on-straight-legs rule was measured against this harness and it
    // suppressed *every* real rep (5 of 5 seated reps became 0), because a
    // real rep is above `bentAngleDeg` for most of its own duration.
    //
    // The boundary is therefore the configured tolerance, verified here rather
    // than assumed. Both trips are `maxAnchorOffset` +/- 0.02 so the tests track
    // the config instead of hard-coding today's number.
    // ---------------------------------------------------------------------
    const TOLERANCE = SEATED_KNEE_EXTENSION.readiness.maxAnchorOffset;

    /** Rises, holds standing, then performs an ordinary standing weight shift. */
    const standThenShift = (hipTravel: number): SessionEngine => {
      const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
      let t = reachReady(engine);
      t = standUp(engine, t, 15, hipTravel);
      const standing = { bodyY: -hipTravel };
      for (let k = 0; k < 14; k++) {
        engine.handlePoseFrame(frame(pose(SHIFT_PEAK, SHIFT_PEAK, standing), t));
        t += 100;
      }
      for (const angle of [SHIFT_DIP, SHIFT_PEAK, SHIFT_DIP]) {
        for (let k = 0; k < 4; k++) {
          engine.handlePoseFrame(frame(pose(angle, angle, standing), t));
          t += 100;
        }
      }
      return engine;
    };

    /** Rises, holds standing, then lowers back into the chair. */
    const standThenSit = (hipTravel: number): SessionEngine => {
      const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
      let t = reachReady(engine);
      t = standUp(engine, t, 15, hipTravel);
      const standing = { bodyY: -hipTravel };
      for (let k = 0; k < 10; k++) {
        engine.handlePoseFrame(frame(pose(STRAIGHT, STRAIGHT, standing), t));
        t += 100;
      }
      sitBackDown(engine, t, 15, hipTravel);
      for (let k = 0; k < 20; k++) {
        engine.handlePoseFrame(frame(pose(REST, REST), t));
        t += 100;
      }
      return engine;
    };

    const beyondTolerance = TOLERANCE + 0.02;
    const withinTolerance = TOLERANCE - 0.02;

    const shiftBeyond = standThenShift(beyondTolerance);
    check(
      'a stand-up travelling past the anchor tolerance drops readiness',
      shiftBeyond.readinessPhase !== 'ready',
      shiftBeyond.readinessPhase,
    );
    check(
      'so a weight shift after it counts nothing',
      shiftBeyond.reps === 0,
      shiftBeyond.reps,
    );

    const sitBeyond = standThenSit(beyondTolerance);
    check(
      'sitting back down after a stand-up past the tolerance counts nothing',
      sitBeyond.reps === 0,
      sitBeyond.reps,
    );

    // --- KNOWN RESIDUAL ---------------------------------------------------
    // Below the tolerance the anchor never displaces, readiness is never lost,
    // and both motions are counted. This is a real defect, pinned deliberately
    // so that fixing it (which requires real hip-travel measurements from a
    // device) fails loudly instead of passing unnoticed. It must not be read as
    // expected behaviour.
    const shiftWithin = standThenShift(withinTolerance);
    check(
      'KNOWN RESIDUAL: a low-travel stand-up leaves readiness armed',
      shiftWithin.readinessPhase === 'ready',
      shiftWithin.readinessPhase,
    );
    check(
      'KNOWN RESIDUAL: a weight shift after it is counted as a rep',
      shiftWithin.reps > 0,
      shiftWithin.reps,
    );

    const sitWithin = standThenSit(withinTolerance);
    check(
      'KNOWN RESIDUAL: sitting back down after a low-travel stand-up is counted as a rep',
      sitWithin.reps > 0,
      sitWithin.reps,
    );

    // A real seated rep must still be counted, unchanged, at the seated baseline.
    const genuine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let gt = reachReady(genuine);
    for (let i = 0; i < 5; i++) gt = doLeftRep(genuine, gt);
    check('five genuine seated reps still count', genuine.reps === 5, genuine.reps);
  });

  // ==========================================================================
  // The occasional MISSED genuine rep, end to end.
  //
  // A seated knee that only reaches ~163deg — it never locks, and the config
  // never asked it to — puts its plateau right on `extendedAngleDeg`. Model
  // jitter dips under that band repeatedly, and the `extending` state used to
  // reset its hold counter on every dip, so the machine demanded strictly
  // consecutive straight frames that this plateau can never produce. It never
  // reached `extended`; the descent then tripped the false-start branch, which
  // reset the cycle and discarded the observed range. The rep vanished.
  //
  // The correction is in RepDetector (an intermediate frame no longer wipes the
  // extension hold). These tests drive the whole pipeline, so they also prove the
  // readiness gate, the resting-posture precondition, session aggregation and
  // the loss/pause/gap guards all still behave.
  // ==========================================================================

  /**
   * A genuine seated rep from a knee that only reaches 163deg. The plateau dips
   * below `extendedAngleDeg` three times, which used to lose the rep outright.
   */
  const PLATEAU = [REST, 120, 150, 163, 158, 159, 166, 157, 158, 164, 150, 120, REST, REST];

  /** Feeds a left-leg cadence; the right leg stays seated. */
  function doLeftCadence(engine: SessionEngine, startMs: number, angles: number[]): number {
    let t = startMs;
    for (const angle of angles) engine.handlePoseFrame(frame(pose(angle, REST), t)), (t += 100);
    return t;
  }

  /**
   * Feeds both legs the same cadence. In the side view this app uses, the far
   * leg is occluded and the model infers it from the near one, so a real
   * movement really does arrive as the same angle on both sides. That is what
   * makes the session-level cooldown necessary, and what these tests exercise.
   */
  function doBothCadence(engine: SessionEngine, startMs: number, angles: number[]): number {
    let t = startMs;
    for (const angle of angles) engine.handlePoseFrame(frame(pose(angle, angle), t)), (t += 100);
    return t;
  }

  suite('missed rep: a knee that only reaches ~163deg still counts', () => {
    const left = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(left);
    t = doLeftCadence(left, t, PLATEAU);
    check('a sub-160 plateau counts on the left', left.reps === 1, left.reps);

    const right = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = reachReady(right);
    for (const angle of PLATEAU) {
      right.handlePoseFrame(frame(pose(REST, angle), t));
      t += 100;
    }
    check('a sub-160 plateau counts on the right', right.reps === 1, right.reps);

    const both = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = reachReady(both);
    t = doBothCadence(both, t, PLATEAU);
    check('but one aliased movement is still only one rep', both.reps === 1, both.reps);

    const repeated = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = reachReady(repeated);
    for (let i = 0; i < 4; i++) t = doLeftCadence(repeated, t, PLATEAU);
    check('four consecutive sub-160 plateau reps all count', repeated.reps === 4, repeated.reps);
  });

  suite('missed rep: a sub-160 plateau is still not a standing rep', () => {
    // The plateau shape must not become a new way for standing to score. It
    // still has to get past the resting-posture precondition, which a straight
    // leg cannot.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 20; i++) {
      engine.handlePoseFrame(frame(pose(168, 168), t));
      t += 100;
    }
    check('standing never reaches readiness', engine.readinessPhase !== 'ready', engine.readinessPhase);
    t = doBothCadence(engine, t, PLATEAU);
    check('a plateau from standing counts nothing', engine.reps === 0, engine.reps);
  });

  suite('missed rep: a sub-160 plateau cannot walk through the safety guards', () => {
    // Tracking loss partway through.
    const lost = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(lost);
    for (const angle of [REST, 120, 150, 163, 158]) {
      lost.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    for (let i = 0; i < 6; i++) {
      lost.handlePoseFrame(frame(pose(166, 166), t, 'lost'));
      t += 100;
    }
    for (const angle of [157, 158, 164, 150, 120, REST, REST]) {
      lost.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('a plateau broken by tracking loss counts nothing', lost.reps === 0, lost.reps);

    // A stall longer than maxFrameGapMs, which must discard the partial cycle.
    const stalled = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = reachReady(stalled);
    for (const angle of [REST, 120, 150, 163, 158]) {
      stalled.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    t += SEATED_KNEE_EXTENSION.thresholds.maxFrameGapMs + 500;
    for (const angle of [166, 157, 164, 150, 120, REST, REST]) {
      stalled.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('a plateau broken by a long frame gap counts nothing', stalled.reps === 0, stalled.reps);

    // Pause mid-plateau, then resume.
    const paused = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = reachReady(paused);
    for (const angle of [REST, 120, 150, 163, 158]) {
      paused.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    paused.pause();
    t += 2000;
    for (const angle of [166, 157, 164, 150, 120, REST, REST]) {
      paused.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('a plateau spanning a pause counts nothing', paused.reps === 0, paused.reps);
  });

  suite('missed rep: a shallow plateau is still rejected on range', () => {
    // Same jittery shape, but the knee never travels far enough. Seated at 138
    // and peaking at 162 the cycle is 24deg, one degree under minRangeDeg(25).
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(138, 138), t));
      t += 100;
    }
    check('it does reach readiness from a 138deg seat', engine.readinessPhase === 'ready', engine.readinessPhase);
    for (const angle of [150, 162, 158, 162, 159, 162, 150, 138, 138, 138]) {
      engine.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('a 24deg cycle is still rejected', engine.reps === 0, engine.reps);

    // One degree more of travel and the very same shape is accepted, which
    // proves the rejection above came from the range guard and not from the
    // tolerant hold refusing to commit.
    const wider = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = 0;
    for (let i = 0; i < 14; i++) {
      wider.handlePoseFrame(frame(pose(138, 138), t));
      t += 100;
    }
    for (const angle of [150, 163, 158, 163, 159, 163, 150, 138, 138, 138]) {
      wider.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('the same shape at 25deg is accepted', wider.reps === 1, wider.reps);
  });

  // ==========================================================================
  // The return/rest hold, end to end.
  //
  // `restHold` used to be wiped by any frame in the 140-160 dead band, so a rep
  // needed `holdFrames` strictly CONSECUTIVE frames at or below
  // `bentAngleDeg`. A descent normally bottoms out in a sustained seated
  // posture well under 140deg, which supplies plenty of consecutive frames — so
  // this did not fail often. It failed when the resting knee angle sat within a
  // few degrees of 140deg (a moderately open seated knee), where the pose
  // estimate jitters across the boundary and consecutive qualifying frames never
  // occur. The rep was then lost outright, at random depending on where the
  // jitter happened to land.
  //
  // These tests drive the whole pipeline, so the readiness gate, the
  // resting-posture precondition, session aggregation and the loss/pause/gap
  // guards are all exercised alongside the detector.
  // ==========================================================================

  /** Arms, extends fully, then returns through the supplied descent. */
  const descent = (tail: number[]): number[] => [REST, 120, 150, 163, 163, 163, ...tail];
  /** Deterministic strictly-alternating jitter across a centre angle. */
  const altAround = (centre: number, amp: number, n: number): number[] =>
    Array.from({ length: n }, (_, i) => centre + (i % 2 === 0 ? -amp : amp));

  /** Feeds a both-legs cadence (the far leg is model-inferred from the near one). */
  function doBoth(engine: SessionEngine, startMs: number, angles: number[]): number {
    let t = startMs;
    for (const angle of angles) engine.handlePoseFrame(frame(pose(angle, angle), t)), (t += 100);
    return t;
  }

  /** Settles at `seat` (a seated posture), then runs one descent-returned rep. */
  function seatedRep(angles: number[], seat = REST): SessionEngine {
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 14; i++) {
      engine.handlePoseFrame(frame(pose(seat, seat), t));
      t += 100;
    }
    doBoth(engine, t, angles);
    return engine;
  }

  suite('missed rep: a rest posture sitting on bentAngleDeg still counts', () => {
    const alternating = seatedRep(descent(altAround(139, 4, 12)));
    check(
      'a seated rep returning to ~139deg with alternating jitter counts',
      alternating.reps === 1,
      alternating.reps,
    );

    const wider = seatedRep(descent(altAround(135, 8, 14)));
    check('the same at ~135deg with a wider swing counts', wider.reps === 1, wider.reps);

    const repeated = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(repeated);
    for (let i = 0; i < 3; i++) t = doBoth(repeated, t, descent(altAround(139, 4, 12)));
    check('three such reps in a row all count', repeated.reps === 3, repeated.reps);

    // The far leg mirrors the near one, so both detectors see the same movement
    // and the session cooldown must still collapse it to a single rep.
    check('and an aliased one is still only one rep', alternating.reps === 1, alternating.reps);
  });

  suite('missed rep: the tolerant rest hold still refuses a non-return', () => {
    // Exactly one frame at or below bentAngleDeg, then the leg climbs back out.
    const spike = seatedRep(
      descent([145, 139, 150, 147, 145, 142, 146, 143, 141, 148, 145, 142, 147, 144, 146, 143, 150, 148]),
    );
    check('a single sub-140 frame never completes a rep', spike.reps === 0, spike.reps);

    // The leg never reaches the bent band at all.
    const noReturn = seatedRep(descent([150, 145, 142, 148, 144, 141, 147, 143, 145, 142, 149, 144, 146, 143, 148, 141]));
    check('a descent that never reaches bentAngleDeg counts nothing', noReturn.reps === 0, noReturn.reps);
  });

  suite('missed rep: a rest posture on the boundary cannot walk past the guards', () => {
    // Tracking loss partway through the return.
    const lost = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = reachReady(lost);
    for (const angle of [REST, 120, 150, 163, 163, 163, 150, 145, 138]) {
      lost.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    for (let i = 0; i < 6; i++) {
      lost.handlePoseFrame(frame(pose(140, 140), t, 'lost'));
      t += 100;
    }
    for (const angle of [142, 139, 136, 141, 138, 135, 90, 90, 90]) {
      lost.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('a boundary return broken by tracking loss counts nothing', lost.reps === 0, lost.reps);

    // A stall longer than maxFrameGapMs during the return.
    const stalled = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = reachReady(stalled);
    for (const angle of [REST, 120, 150, 163, 163, 163, 150, 145, 138]) {
      stalled.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    t += SEATED_KNEE_EXTENSION.thresholds.maxFrameGapMs + 500;
    for (const angle of [142, 139, 136, 141, 138, 135, 90, 90, 90]) {
      stalled.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('a boundary return broken by a long frame gap counts nothing', stalled.reps === 0, stalled.reps);

    // Pause during the return, then resume.
    const paused = new SessionEngine(SEATED_KNEE_EXTENSION);
    t = reachReady(paused);
    for (const angle of [REST, 120, 150, 163, 163, 163, 150, 145, 138]) {
      paused.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    paused.pause();
    t += 2000;
    for (const angle of [142, 139, 136, 141, 138, 135, 90, 90, 90]) {
      paused.handlePoseFrame(frame(pose(angle, angle), t));
      t += 100;
    }
    check('a boundary return spanning a pause counts nothing', paused.reps === 0, paused.reps);
  });

  suite('missed rep: the boundary rest hold does not make standing countable', () => {
    // The gate and the resting-posture precondition, not this state machine, are
    // what keep standing out. A straight leg must still never arm.
    const engine = new SessionEngine(SEATED_KNEE_EXTENSION);
    let t = 0;
    for (let i = 0; i < 20; i++) {
      engine.handlePoseFrame(frame(pose(172, 172), t));
      t += 100;
    }
    check('standing never reaches readiness', engine.readinessPhase !== 'ready', engine.readinessPhase);
    t = doBoth(engine, t, descent(altAround(139, 4, 12)));
    check('a boundary return from standing counts nothing', engine.reps === 0, engine.reps);
  });
}
