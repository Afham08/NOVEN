import type { LandmarkEventPayload, PoseLandmarkName } from '../modules/pose-tracker';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { angleFromTriplet } from '../src/exercise/pose-utils';
import { RepDetector } from '../src/exercise/rep-detector';
import { ReadinessGate } from '../src/exercise/stabilize';
import type { ReadinessConfig, RepThresholds, Side } from '../src/exercise/types';
import { check, suite } from './harness';

const THRESHOLDS: ReadinessConfig & RepThresholds = {
  bentAngleDeg: 140,
  extendedAngleDeg: 160,
  minRangeDeg: 25,
  minRepIntervalMs: 700,
  holdFrames: 2,
  minVisibility: 0.4,
  maxStableDrift: 0.03,
  minStableFrames: 10,
  minStableMs: 1000,
  maxAnchorDrift: 0.04,
  anchorDriftSuspendFrames: 2,
  maxAnchorOffset: 0.12,
  maxFrameGapMs: 1000,
};

const READINESS: ReadinessConfig = {
  minVisibility: 0.4,
  maxStableDrift: 0.03,
  minStableFrames: 10,
  minStableMs: 1000,
  maxAnchorDrift: 0.04,
  anchorDriftSuspendFrames: 2,
  maxAnchorOffset: 0.12,
};

const REQUIRED_JOINTS: PoseLandmarkName[] = [
  'LEFT_HIP',
  'LEFT_KNEE',
  'LEFT_ANKLE',
  'RIGHT_HIP',
  'RIGHT_KNEE',
  'RIGHT_ANKLE',
];

const ANCHOR_JOINTS: PoseLandmarkName[] = ['LEFT_HIP', 'RIGHT_HIP'];

type XY = { x: number; y: number };

const SIDES = ['left', 'right'] as const;
const SIDE_NAMES: Record<Side, { hip: PoseLandmarkName; knee: PoseLandmarkName; ankle: PoseLandmarkName }> = {
  left: { hip: 'LEFT_HIP', knee: 'LEFT_KNEE', ankle: 'LEFT_ANKLE' },
  right: { hip: 'RIGHT_HIP', knee: 'RIGHT_KNEE', ankle: 'RIGHT_ANKLE' },
};
const SIDE_GEOMETRY: Record<Side, { hip: XY; knee: XY }> = {
  left: { hip: { x: 0.46, y: 0.3 }, knee: { x: 0.46, y: 0.5 } },
  right: { hip: { x: 0.54, y: 0.3 }, knee: { x: 0.54, y: 0.5 } },
};

function ankleFor(hip: XY, knee: XY, angleDeg: number): XY {
  const hdir = Math.atan2(hip.y - knee.y, hip.x - knee.x);
  const rad = hdir - (angleDeg * Math.PI) / 180;
  return { x: knee.x + Math.cos(rad) * 0.28, y: knee.y + Math.sin(rad) * 0.28 };
}

/** Synthetic pose with the chosen knee angles per side; degree-agnostic helpers. */
function makePose(
  leftAngle: number,
  rightAngle: number,
  opts: { visibility?: number; omit?: PoseLandmarkName[]; nan?: PoseLandmarkName[] } = {},
): LandmarkEventPayload[] {
  const visibility = opts.visibility ?? 1;
  const omit = new Set(opts.omit ?? []);
  const nan = new Set(opts.nan ?? []);
  const landmarks: LandmarkEventPayload[] = [];

  for (const side of SIDES) {
    const { hip, knee } = SIDE_GEOMETRY[side];
    const names = SIDE_NAMES[side];
    const ankle = ankleFor(hip, knee, side === 'left' ? leftAngle : rightAngle);
    const pieces = [
      [names.hip, hip],
      [names.knee, knee],
      [names.ankle, ankle],
    ] as const;

    for (const [name, point] of pieces) {
      if (omit.has(name)) continue;
      const broken = nan.has(name);
      landmarks.push({
        name,
        x: broken ? Number.NaN : point.x,
        y: broken ? Number.NaN : point.y,
        z: 0,
        visibility,
      });
    }
  }
  return landmarks;
}

/** Moves every joint slightly so consecutive frames exceed maxStableDrift. */
function jitteredPose(base: LandmarkEventPayload[], step: number, tick: number): LandmarkEventPayload[] {
  return base.map((landmark) => ({
    ...landmark,
    x: landmark.x + Math.sin(tick + landmark.x * 100) * step,
    y: landmark.y + Math.cos(tick + landmark.y * 50) * step,
  }));
}

/**
 * Translates the ENTIRE body by (dx, dy). Each frame the whole pose shifts
 * like the person walking toward/away from the camera: the hip anchor moves
 * with everything else, unlike a rep where only the knee/ankle move.
 */
function translatedPose(base: LandmarkEventPayload[], dx: number, dy: number): LandmarkEventPayload[] {
  return base.map((landmark) => ({ ...landmark, x: landmark.x + dx, y: landmark.y + dy }));
}

/**
 * Mirrors the session screen's gating contract: detectors are only fed when
 * the gate is ready; otherwise they are frozen. This is the exact wiring being
 * verified at the session level.
 */
class GatedSession {
  readonly gate = new ReadinessGate(REQUIRED_JOINTS, READINESS, ANCHOR_JOINTS);
  private readonly left = new RepDetector(THRESHOLDS);
  private readonly right = new RepDetector(THRESHOLDS);

  get reps(): number {
    return this.left.completedReps + this.right.completedReps;
  }

  feed(landmarks: LandmarkEventPayload[], timestampMs: number): void {
    this.gate.process(landmarks, timestampMs);
    if (this.gate.currentPhase !== 'ready') {
      this.left.freeze();
      this.right.freeze();
      return;
    }
    for (const side of SIDES) {
      const detector = side === 'left' ? this.left : this.right;
      const angle = angleFromTriplet(
        landmarks,
        SEATED_KNEE_EXTENSION.triplets[side],
        THRESHOLDS.minVisibility,
      );
      if (!Number.isFinite(angle)) continue;
      detector.process({ angle, timestampMs });
    }
  }

  lose(): void {
    this.gate.markLost();
    this.left.freeze();
    this.right.freeze();
  }

  /**
   * Mirrors the session screen's paused branch: `handlePoseFrame` returns
   * before touching the gate or the detectors, so neither the gate state nor
   * the rep counters move while a session is paused.
   */
  pause(): void {
    this.left.freeze();
    this.right.freeze();
  }

  /** START: reset the rep detectors, as `start()` does in the session screen. */
  restartDetectors(): void {
    this.left.reset();
    this.right.reset();
  }
}

/** Still, valid, visible seated pose. */
const STILL = makePose(90, 90);

/** A single full flexion cycle of the left leg, right leg idle. */
function leftLegCycle(t0: number): { landmarks: LandmarkEventPayload[]; ts: number }[] {
  const angles = [90, 120, 150, 170, 170, 130, 110, 90, 90];
  return angles.map((angle, i) => ({ landmarks: makePose(angle, 90), ts: t0 + i * 100 }));
}

export function run(): void {
  suite('readiness: entering the frame never counts', () => {
    const session = new GatedSession();
    let tick = 0;
    for (let i = 0; i < 30; i += 1) {
      session.feed(jitteredPose(STILL, 0.08, tick), tick * 100);
      tick += 1;
    }
    check('0 reps while entering the frame', session.reps === 0);
    check('gate never became ready while moving', session.gate.currentPhase !== 'ready');
  });

  suite('readiness: moving into position counts nothing during stabilization', () => {
    const session = new GatedSession();
    let ts = 0;
    for (let i = 0; i < 5; i += 1) {
      session.feed(jitteredPose(STILL, 0.05, i), ts);
      ts += 125;
    }
    // Still for 9 frames: not enough to satisfy minStableFrames/minStableMs.
    for (let i = 0; i < 9; i += 1) {
      session.feed(STILL, ts);
      ts += 125;
    }
    check('0 reps during stabilization', session.reps === 0);
    check('gate not ready after move-then-short-still', session.gate.currentPhase !== 'ready');
  });

  suite('readiness: stabilization completes and activates counting', () => {
    const session = new GatedSession();
    let becameReadyCount = 0;
    for (let i = 0; i < 12; i += 1) {
      const outcome = session.gate.process(STILL, i * 125);
      session.feed(STILL, i * 125);
      if (outcome.becameReady) becameReadyCount += 1;
    }
    check('gate reached ready', session.gate.currentPhase === 'ready');
    check('ready transition fired exactly once', becameReadyCount === 1);
    check('baseline posture anchored at readiness', session.gate.baselinePose !== null);

    // Detector is live now: a real cycle must be counted.
    for (const frame of leftLegCycle(2000)) {
      session.feed(frame.landmarks, frame.ts);
    }
    check('one clean rep counted after readiness', session.reps === 1);
  });

  suite('readiness: a valid rep counts exactly one', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    for (const frame of leftLegCycle(2000)) session.feed(frame.landmarks, frame.ts);
    check('exactly one rep after readiness + one cycle', session.reps === 1);
  });

  suite('readiness: leaving the frame never counts', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    session.lose();
    for (let i = 0; i < 20; i += 1) {
      session.feed(jitteredPose(STILL, 0.08, i), 2000 + i * 100);
    }
    check('0 reps after the person left', session.reps === 0);
    check('gate demoted to waiting', session.gate.currentPhase === 'waiting');
  });

  suite('readiness: returning requires a fresh stabilization window', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    session.lose();
    // Returns but only holds still for 3 frames: must NOT be ready yet.
    for (let i = 0; i < 3; i += 1) session.feed(STILL, 3000 + i * 125);
    check('short return is not ready', session.gate.currentPhase !== 'ready');
    // Holds still long enough: readiness re-acquired.
    for (let i = 3; i < 12; i += 1) session.feed(STILL, 3000 + i * 125);
    check('re-stabilization completes', session.gate.currentPhase === 'ready');
    check('no reps were invented across the break', session.reps === 0);
  });

  suite('readiness: movement during re-stabilization counts nothing', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    session.lose();
    let tick = 0;
    for (let i = 0; i < 20; i += 1) {
      session.feed(jitteredPose(STILL, 0.08, tick), 3000 + i * 100);
      tick += 1;
    }
    check('0 reps while re-entering erratically', session.reps === 0);
    check('gate not ready during erratic re-entry', session.gate.currentPhase !== 'ready');
  });

  suite('readiness: low visibility blocks readiness', () => {
    const session = new GatedSession();
    const dim = makePose(90, 90, { visibility: 0.1 });
    for (let i = 0; i < 15; i += 1) session.feed(dim, i * 125);
    check('dim joints never grant readiness', session.gate.currentPhase !== 'ready');
    for (let i = 0; i < 12; i += 1) session.feed(STILL, 3000 + i * 125);
    check('visible joints grant readiness', session.gate.currentPhase === 'ready');
    check('0 reps through visibility gating', session.reps === 0);
  });

  suite('readiness: NaN coordinates block without crashing', () => {
    const session = new GatedSession();
    const broken = makePose(90, 90, { nan: ['LEFT_KNEE'] });
    for (let i = 0; i < 15; i += 1) session.feed(broken, i * 125);
    check('NaN joint never grants readiness', session.gate.currentPhase !== 'ready');
    check('no crash, no fake reps', session.reps === 0);
    for (let i = 0; i < 12; i += 1) session.feed(STILL, 3000 + i * 125);
    check('recovers once coordinates are finite', session.gate.currentPhase === 'ready');
  });

  suite('readiness: counted reps survive a tracking loss', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    for (const frame of leftLegCycle(2000)) session.feed(frame.landmarks, frame.ts);
    check('one rep before losing the person', session.reps === 1);
    session.lose();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, 4000 + i * 125);
    for (const frame of leftLegCycle(6000)) session.feed(frame.landmarks, frame.ts);
    check('first rep preserved and a second one added', session.reps === 2);
  });

  suite('readiness: missing required joint blocks readiness', () => {
    const session = new GatedSession();
    const missingAnkle = makePose(90, 90, { omit: ['LEFT_ANKLE'] });
    for (let i = 0; i < 15; i += 1) session.feed(missingAnkle, i * 125);
    check('missing joint never grants readiness', session.gate.currentPhase !== 'ready');
    for (let i = 0; i < 12; i += 1) session.feed(STILL, 3000 + i * 125);
    check('full joint set grants readiness', session.gate.currentPhase === 'ready');
  });

  suite('readiness: rep movement does not demote a ready gate', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    // A real rep moves the tracked joints well past maxStableDrift, yet the
    // gate must stay ready (a rep IS movement) and the rep must be counted.
    for (const frame of leftLegCycle(2000)) session.feed(frame.landmarks, frame.ts);
    check('ready gate stays ready through rep movement', session.gate.currentPhase === 'ready');
    check('rep performed from ready counts exactly one', session.reps === 1);
  });

  suite('readiness: walking toward the camera suspends counting', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    check('gate ready before walking', session.gate.currentPhase === 'ready');
    // Whole body translates ~0.06 per frame (way past maxAnchorDrift 0.04).
    for (let i = 0; i < 8; i += 1) {
      session.feed(translatedPose(STILL, (i + 1) * 0.06, (i + 1) * 0.02), 2000 + i * 100);
    }
    check('walking demotes the gate to waiting', session.gate.currentPhase !== 'ready');
    check('walking toward the camera creates no reps', session.reps === 0);
    // Two consecutive overshoots are required; one modest overshoot must not
    // yet suspend counting (so a slow lean does not drop the gate instantly).
    const lean = new GatedSession();
    for (let i = 0; i < 12; i += 1) lean.feed(STILL, i * 125);
    lean.feed(translatedPose(STILL, 0.05, 0), 2000);
    check('single modest overshoot does not suspend yet', lean.gate.currentPhase === 'ready');
  });

  suite('readiness: extreme single-frame translation suspends immediately', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    // A step-sized jump (>4x maxAnchorDrift) in one frame.
    session.feed(translatedPose(STILL, 0.4, 0), 2000);
    check('teleport demotes instantly', session.gate.currentPhase !== 'ready');
    check('teleport creates no reps', session.reps === 0);
  });

  suite('readiness: counted reps survive a walking break and counting resumes', () => {    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    for (const frame of leftLegCycle(2000)) session.feed(frame.landmarks, frame.ts);
    check('one rep before walking', session.reps === 1);
    for (let i = 0; i < 5; i += 1) {
      session.feed(translatedPose(STILL, (i + 1) * 0.07, 0), 4000 + i * 100);
    }
    check('walking suspends counting', session.gate.currentPhase !== 'ready');
    for (let i = 0; i < 12; i += 1) session.feed(STILL, 6000 + i * 125);
    check('settling re-enables counting', session.gate.currentPhase === 'ready');
    for (const frame of leftLegCycle(8000)) session.feed(frame.landmarks, frame.ts);
    check('first rep preserved and a new one added after re-readiness', session.reps === 2);
  });

  suite('readiness: slow approach toward the camera suspends counting', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    check('gate ready before the approach', session.gate.currentPhase === 'ready');

    // A deliberate stroll: 0.02/frame, i.e. never breaches the 0.04 per-frame
    // drift limit, but the hips climb 0.30 of the frame — far past
    // maxAnchorOffset. Per-frame drift alone would let this through.
    let ts = 2000;
    let caughtAt = 0;
    for (let i = 1; i <= 14; i += 1) {
      session.feed(translatedPose(STILL, 0, -i * 0.02), ts);
      ts += 100;
      if (session.gate.currentPhase !== 'ready') {
        caughtAt = i;
        break;
      }
    }
    check('slow approach is caught mid-walk, not at the end', caughtAt > 0 && caughtAt < 14);
    check('slow approach suspends counting', session.gate.currentPhase !== 'ready');
    check('slow approach creates no reps', session.reps === 0);
  });

  suite('readiness: sitting down suspends counting', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    check('gate ready before sitting', session.gate.currentPhase === 'ready');
    // The body descends onto the chair: hips sink 0.025/frame for ~1.2s.
    let ts = 2000;
    for (let i = 1; i <= 14; i += 1) {
      session.feed(translatedPose(STILL, 0.005 * i, i * 0.025), ts);
      ts += 100;
      if (session.gate.currentPhase !== 'ready') break;
    }
    check('sitting down suspends counting', session.gate.currentPhase !== 'ready');
    check('sitting down creates no reps', session.reps === 0);
  });

  suite('readiness: standing up after a rep suspends counting', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    for (const frame of leftLegCycle(2000)) session.feed(frame.landmarks, frame.ts);
    check('one rep counted before standing', session.reps === 1);
    // Hips rise 0.025/frame: the reverse of sitting, same rejection rule.
    let ts = 4000;
    for (let i = 1; i <= 14; i += 1) {
      session.feed(translatedPose(STILL, 0, -i * 0.025), ts);
      ts += 100;
      if (session.gate.currentPhase !== 'ready') break;
    }
    check('standing up suspends counting', session.gate.currentPhase !== 'ready');
    check('standing up creates no new reps', session.reps === 1);
  });

  suite('readiness: ordinary seated postural shift keeps counting alive', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    // Leaning forward/back in the chair, adjusting grip: hips wander a few
    // percent of the frame. This must NOT be mistaken for relocation.
    let ts = 2000;
    for (let i = 0; i < 10; i += 1) {
      session.feed(translatedPose(STILL, Math.sin(i / 2) * 0.03, Math.cos(i / 3) * 0.05), ts);
      ts += 100;
    }
    check('small postural shift keeps the gate ready', session.gate.currentPhase === 'ready');
    for (const frame of leftLegCycle(ts + 500)) session.feed(frame.landmarks, frame.ts);
    check('a rep still counts after shifting posture', session.reps === 1);
  });

  suite('readiness: paused session counts nothing and resumes cleanly', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    for (const frame of leftLegCycle(2000)) session.feed(frame.landmarks, frame.ts);
    check('one rep counted before pausing', session.reps === 1);

    // Paused: pose frames keep arriving but the session ignores them entirely,
    // so even a full rep played out during the pause must not be counted.
    session.pause();
    for (const frame of leftLegCycle(4000)) {
      session.pause();
      // A paused session never advances the gate or the detectors.
    }
    check('reps frozen while paused', session.reps === 1);

    // Resume with the body where it left off: counting continues immediately.
    for (let i = 0; i < 12; i += 1) session.feed(STILL, 6000 + i * 125);
    check('gate ready again after resume', session.gate.currentPhase === 'ready');
    for (const frame of leftLegCycle(8000)) session.feed(frame.landmarks, frame.ts);
    check('counting continues after resume', session.reps === 2);
  });

  suite('readiness: pausing mid-rep cannot be completed by the return stroke', () => {
    // Regression: pause() must freeze the in-progress rep cycle. Without the
    // freeze, an extension played before the pause and a return played after the
    // resume would join up and count one phantom rep that never physically
    // happened as a single continuous movement.
    const angles = [90, 120, 150, 170, 170, 130, 110, 90, 90];

    // Control: an uninterrupted pass through the same angles DOES count a rep,
    // proving the fixture is a genuine full cycle and not an invalid one.
    const control = new GatedSession();
    for (let i = 0; i < 12; i += 1) control.feed(STILL, i * 125);
    angles.forEach((angle, i) => control.feed(makePose(angle, 90), 2000 + i * 100));
    check('control: the same uninterrupted cycle counts one rep', control.reps === 1);

    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);

    // Extend the leg and confirm the machine is mid-cycle (held extension).
    angles.slice(0, 5).forEach((angle, i) => session.feed(makePose(angle, 90), 2000 + i * 100));
    check('mid-cycle: a rep is not counted at full extension', session.reps === 0);

    // The user pauses here, then resumes with the leg still up.
    session.pause();
    angles.slice(5).forEach((angle, i) => session.feed(makePose(angle, 90), 4000 + i * 100));

    check('the return stroke after resume does not complete the rep', session.reps === 0);

    // And a genuinely NEW, complete rep after the resume still counts, so the
    // freeze did not permanently break counting.
    angles.forEach((angle, i) => session.feed(makePose(angle, 90), 6000 + i * 100));
    check('a fresh full rep after resume still counts', session.reps === 1);
  });

  suite('readiness: session start resets all prior state', () => {
    const session = new GatedSession();
    for (let i = 0; i < 12; i += 1) session.feed(STILL, i * 125);
    for (const frame of leftLegCycle(2000)) session.feed(frame.landmarks, frame.ts);
    check('a rep was counted before the restart', session.reps === 1);

    // START resets the gate and both detectors.
    session.gate.reset();
    session.restartDetectors();
    check('start clears the rep count', session.reps === 0);
    check('start returns the gate to waiting', session.gate.currentPhase === 'waiting');
    // A full rep during the stabilization window must not be counted.
    for (const frame of leftLegCycle(3000)) session.feed(frame.landmarks, frame.ts);
    check('no reps during the post-start stabilization', session.reps === 0);
  });
}