import type { LandmarkEventPayload, PoseFrameEventPayload, PoseLandmarkName } from '../modules/pose-tracker';
import { check, suite } from './harness';

import { SEATED_KNEE_EXTENSION } from '../src/exercise/configs';
import { isTrustedLandmark, isTrustedSide, MIN_TRUSTED_PRESENCE } from '../src/exercise/landmark-trust';
import { SEATED_ARM_RAISE, SIT_TO_STAND } from '../src/exercise/pose-configs';
import { SessionEngine } from '../src/exercise/session-engine';
import type { ExerciseConfig, Side } from '../src/exercise/types';

/**
 * ============================================================================
 * Landmark trust: the policy that decides WHICH landmarks may grant readiness
 * ============================================================================
 *
 * THE DEVICE BUG THIS LOCKS DOWN
 * On a real phone, every one of the three camera-guided exercises refused to
 * become ready for a correctly-positioned user ("Move into position" forever),
 * and could be granted readiness by a user standing up. Neither symptom is a
 * threshold problem; both are questions about which landmarks are allowed to
 * decide anything:
 *
 *  1. Readiness demanded EVERY required landmark be trustworthy, so one occluded
 *     far-side joint vetoed readiness forever.
 *  2. The starting-posture check accepted ONE side's angle, so a single
 *     model-inferred leg could grant readiness to somebody standing.
 *
 * These suites cover all three camera-guided exercises at both layers where the
 * decision is made: the shared trust policy itself, and the SessionEngine that
 * composes it into the gate.
 *
 * The landmark geometry is generated FROM each config's own triplets, so these
 * tests keep their meaning if a config is retuned or a new camera exercise is
 * added: nothing here hardcodes which joint is measured.
 */

type XY = { x: number; y: number };

const SIDES: readonly Side[] = ['left', 'right'];

/**
 * A stable base point per side for the triplet's FIRST landmark, plus the
 * offset to the MIDDLE landmark. The first landmark of every camera config is
 * the hip, which is also the readiness anchor, so keeping it fixed is what lets a
 * still pose read as still.
 */
const BASE: Record<Side, { first: XY; second: XY }> = {
  left: { first: { x: 0.46, y: 0.3 }, second: { x: 0.46, y: 0.5 } },
  right: { first: { x: 0.54, y: 0.3 }, second: { x: 0.54, y: 0.5 } },
};

/** How far the third landmark sits from the middle one. */
const LIMB_LENGTH = 0.28;

function thirdPoint(first: XY, second: XY, angleDeg: number): XY {
  const firstDir = Math.atan2(first.y - second.y, first.x - second.x);
  const rad = firstDir - (angleDeg * Math.PI) / 180;
  return {
    x: second.x + Math.cos(rad) * LIMB_LENGTH,
    y: second.y + Math.sin(rad) * LIMB_LENGTH,
  };
}

/** Per-side trust scores, so a test can break exactly one side. */
type SideScores = { visibility: number; presence: number };

type PoseOpts = {
  /** Overrides for one side only; anything not named uses `scores`. */
  scores?: SideScores;
  leftScores?: Partial<SideScores>;
  rightScores?: Partial<SideScores>;
  /** Per-landmark overrides, used to prove untrustworthy points cannot decide. */
  jitter?: Record<string, number>;
};

function merge(scores: SideScores | undefined, partial: Partial<SideScores> | undefined): SideScores {
  return {
    visibility: partial?.visibility ?? scores?.visibility ?? 1,
    presence: partial?.presence ?? scores?.presence ?? 1,
  };
}

/**
 * Builds a pose for `config` with the requested angle per side, at whatever
 * measured angle the geometry actually produces.
 *
 * The angle is constructed at the middle landmark of the config's own triplet,
 * which is exactly where `angleFromTriplet` measures, so the value asked for and
 * the value the engine reads are the same number.
 */
function buildPose(
  config: ExerciseConfig,
  angles: Record<Side, number>,
  opts: PoseOpts = {},
): LandmarkEventPayload[] {
  const landmarks: LandmarkEventPayload[] = [];
  for (const side of SIDES) {
    if (!config.sides.includes(side)) continue;
    const triplet = config.triplets[side];
    const { first, second } = BASE[side];
    const third = thirdPoint(first, second, angles[side]);
    const scores = merge(opts.scores, side === 'left' ? opts.leftScores : opts.rightScores);
    const points: [PoseLandmarkName, XY][] = [
      [triplet.hip, first],
      [triplet.knee, second],
      [triplet.ankle, third],
    ];
    for (const [name, point] of points) {
      const wobble = opts.jitter?.[name] ?? 0;
      landmarks.push({
        name,
        x: point.x + wobble,
        y: point.y + wobble,
        z: 0,
        visibility: scores.visibility,
        presence: scores.presence,
      });
    }
  }
  return landmarks;
}

function frame(landmarks: LandmarkEventPayload[], timestampMs: number): { nativeEvent: PoseFrameEventPayload } {
  return { nativeEvent: { timestampMs, presence: 'tracked', landmarks } as PoseFrameEventPayload };
}

/**
 * Feeds one still pose per frame until the gate has had a chance to settle.
 * 14 frames at 100ms is comfortably past minStableFrames=10 / minStableMs=1000
 * for all three camera configs.
 */
function settle(engine: SessionEngine, config: ExerciseConfig, angles: Record<Side, number>, opts: PoseOpts = {}): number {
  let t = 0;
  for (let i = 0; i < 14; i += 1) {
    engine.handlePoseFrame(frame(buildPose(config, angles, opts), t));
    t += 100;
  }
  return t;
}

/** The angles that mean "resting" and "fully extended" for a given config. */
function restAngles(config: ExerciseConfig): Record<Side, number> {
  // Derived from the config's own rest band rather than hardcoded per exercise,
  // so this stays meaningful for any camera config: comfortably inside the bent
  // (starting-posture) regime, which is what the posture check requires.
  const angle = Math.min(90, config.thresholds.bentAngleDeg - 25);
  return { left: angle, right: angle };
}
function extendedAngles(): Record<Side, number> {
  // Comfortably past every camera config's extendedAngleDeg (160 / 120 / 165).
  return { left: 178, right: 178 };
}

const CAMERA_CONFIGS: readonly ExerciseConfig[] = [
  SEATED_KNEE_EXTENSION,
  SEATED_ARM_RAISE,
  SIT_TO_STAND,
];

export function run(): void {
  suite('trust policy: a landmark is trusted only as an observation', () => {
    check('presence floor is the documented model default', MIN_TRUSTED_PRESENCE === 0.5);

    const good: LandmarkEventPayload = {
      name: 'LEFT_HIP',
      x: 0.4,
      y: 0.3,
      z: 0,
      visibility: 0.9,
      presence: 0.9,
    };
    check('a visible, present landmark is trusted', isTrustedLandmark(good, 0.4));

    check(
      'a landmark below the visibility floor is untrusted',
      !isTrustedLandmark({ ...good, visibility: 0.2 }, 0.4),
    );
    check(
      'a visible but absent landmark is untrusted: projected, not seen',
      !isTrustedLandmark({ ...good, presence: 0.1 }, 0.4),
    );
    check(
      'a landmark the model did not report presence for is untrusted',
      !isTrustedLandmark({ ...good, presence: 0 }, 0.4),
    );
    check(
      'non-finite coordinates are untrusted whatever the scores say',
      !isTrustedLandmark({ ...good, x: Number.NaN }, 0.4),
    );
    check('a missing landmark is untrusted', !isTrustedLandmark(undefined, 0.4));

    // The floor is the exercise's own, so trust never invents a second,
    // competing visibility threshold.
    check(
      'a stricter exercise floor rejects a landmark it would otherwise accept',
      !isTrustedLandmark({ ...good, visibility: 0.45 }, 0.5),
    );

    // Side-level trust is all-or-nothing: one bad joint makes the side unusable.
    const jointNames: PoseLandmarkName[] = ['LEFT_HIP', 'LEFT_KNEE', 'LEFT_ANKLE'];
    const landmarks: LandmarkEventPayload[] = jointNames.map((name) => ({
      name,
      x: 0.4,
      y: 0.4,
      z: 0,
      visibility: 1,
      presence: 1,
    }));
    check('a complete observed side is trustworthy', isTrustedSide(landmarks, jointNames, 0.4));
    check(
      'one inferred joint makes the whole side untrustworthy',
      !isTrustedSide(
        landmarks.map((landmark) => (landmark.name === 'LEFT_ANKLE' ? { ...landmark, presence: 0 } : landmark)),
        jointNames,
        0.4,
      ),
    );
  });

  for (const config of CAMERA_CONFIGS) {
    const rest = restAngles(config);
    const extended = extendedAngles();

    suite(`${config.id}: an occluded far side cannot veto readiness`, () => {
      // THE DEVICE SYMPTOM. One side fully observed, the other inferred. The
      // observed side is a measurement, so it may grant readiness on its own.
      const occluded = new SessionEngine(config);
      settle(occluded, config, rest, { rightScores: { presence: 0 } });
      check('readiness is granted from the observed side alone', occluded.readinessPhase === 'ready', occluded.readinessPhase);
      check('no rep is invented while settling', occluded.reps === 0);

      // The mirror image: the NEAR side is the one the camera cannot use. The
      // other side still carries readiness, and nothing is counted from the
      // unreadable one.
      const nearUnusable = new SessionEngine(config);
      settle(nearUnusable, config, rest, { leftScores: { presence: 0 } });
      check('readiness is granted from the remaining observed side', nearUnusable.readinessPhase === 'ready', nearUnusable.readinessPhase);
      check('no rep is invented from an unreadable side', nearUnusable.reps === 0);

      // Low visibility on one side is the same case: an occluded limb the model
      // still reports coordinates for.
      const dimSide = new SessionEngine(config);
      settle(dimSide, config, rest, { rightScores: { visibility: 0.2 } });
      check('a dim far side does not block readiness', dimSide.readinessPhase === 'ready', dimSide.readinessPhase);
    });

    suite(`${config.id}: no trustworthy side blocks readiness`, () => {
      const inferredBoth = new SessionEngine(config);
      settle(inferredBoth, config, rest, { scores: { visibility: 1, presence: 0 } });
      check('an all-inferred pose never becomes ready', inferredBoth.readinessPhase !== 'ready', inferredBoth.readinessPhase);
      check('an all-inferred pose counts nothing', inferredBoth.reps === 0);

      const dimBoth = new SessionEngine(config);
      settle(dimBoth, config, rest, { scores: { visibility: 0.2, presence: 1 } });
      check('an all-dim pose never becomes ready', dimBoth.readinessPhase !== 'ready', dimBoth.readinessPhase);

      // Losing every required joint is the crudest form of the same thing.
      const empty = new SessionEngine(config);
      let t = 0;
      for (let i = 0; i < 14; i += 1) {
        empty.handlePoseFrame(frame([], t));
        t += 100;
      }
      check('no landmarks never becomes ready', empty.readinessPhase !== 'ready', empty.readinessPhase);
    });

    suite(`${config.id}: both trustworthy sides must agree on the starting posture`, () => {
      // THE OTHER DEVICE SYMPTOM. Standing is still and hip-stable, so stillness
      // alone grants readiness; the posture check is the only thing that can
      // refuse it, and it must refuse while BOTH sides are readable.
      const standing = new SessionEngine(config);
      settle(standing, config, extended);
      check('standing is never granted readiness', standing.readinessPhase !== 'ready', standing.readinessPhase);
      check('standing counts no rep', standing.reps === 0);

      // Disagreeing trustworthy postures are not a pose either: one side reads
      // bent while the other reads straight is a model artifact, not a person
      // holding the starting position.
      const disagreeing = new SessionEngine(config);
      settle(disagreeing, config, { left: 90, right: 178 });
      check('disagreeing sides are never granted readiness', disagreeing.readinessPhase !== 'ready', disagreeing.readinessPhase);
      check('disagreeing sides count no rep', disagreeing.reps === 0);

      // Both sides genuinely in the starting posture is the one case that must
      // be granted, so the agreement rule cannot be tightened into paralysis.
      const agreed = new SessionEngine(config);
      settle(agreed, config, rest);
      check('agreement in the starting posture is granted', agreed.readinessPhase === 'ready', agreed.readinessPhase);
    });

    suite(`${config.id}: standing cannot hide behind an inferred side`, () => {
      // One side standing, one side inferred. Only the inferred side would read
      // bent, and an inferred side is not allowed to vote at all, so readiness
      // stays refused rather than being granted by the untrustworthy reading.
      const mixed = new SessionEngine(config);
      settle(mixed, config, { left: 178, right: 90 }, { rightScores: { presence: 0 } });
      check('an inferred bent reading cannot grant readiness', mixed.readinessPhase !== 'ready', mixed.readinessPhase);
      check('an inferred bent reading counts no rep', mixed.reps === 0);
    });

    suite(`${config.id}: stillness is measured only on trustworthy landmarks`, () => {
      // A still body whose INFERRED landmarks wander frame to frame. The wander
      // must not reset the calm window, because an untrusted point is not
      // allowed to describe motion.
      const noisyInference = new SessionEngine(config);
      let t = 0;
      for (let i = 0; i < 14; i += 1) {
        const wobble = i % 2 === 0 ? 0.2 : -0.2;
        noisyInference.handlePoseFrame(
          frame(buildPose(config, rest, { rightScores: { presence: 0 }, jitter: { RIGHT_HIP: wobble, RIGHT_KNEE: wobble, RIGHT_ANKLE: wobble } }), t),
        );
        t += 100;
      }
      check('noise on inferred landmarks never destabilizes the window', noisyInference.readinessPhase === 'ready', noisyInference.readinessPhase);

      // The control: the same noise on the OBSERVED side is real motion and must
      // be caught, or the previous check would pass for the wrong reason.
      const noisyObservation = new SessionEngine(config);
      t = 0;
      for (let i = 0; i < 14; i += 1) {
        const wobble = i % 2 === 0 ? 0.2 : -0.2;
        noisyObservation.handlePoseFrame(
          frame(buildPose(config, rest, { jitter: { LEFT_HIP: wobble, LEFT_KNEE: wobble, LEFT_ANKLE: wobble } }), t),
        );
        t += 100;
      }
      check('the same noise on an observed side is caught as motion', noisyObservation.readinessPhase !== 'ready', noisyObservation.readinessPhase);
    });
  }
}