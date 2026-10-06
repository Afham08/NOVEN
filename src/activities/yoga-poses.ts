// Relative, not the `@/` alias: this module is compiled into the plain-Node test
// build, which has no path mapping. The same reason `src/exercise` uses relative
// imports throughout.
import type { PoseLandmarkName } from '../../modules/pose-tracker';

import type { Side } from '../exercise/types';

/**
 * ============================================================================
 * Yoga poses as rules the camera can actually check.
 * ============================================================================
 *
 * WHY THIS FILE IS SEPARATE FROM THE EVALUATOR
 * `yoga-pose-rules.ts` holds the pure geometry. This file holds only data: which
 * landmarks a pose needs, what has to be true, how forgiving each check is, and
 * what to say when it is not. Keeping the numbers here means a pose is described
 * in one readable block, and a test can assert that description without
 * evaluating any geometry at all.
 *
 * SO A STATIC POSE NEEDS ITS OWN SYSTEM AT ALL
 * The existing camera pipeline is a repetition machine. `RepDetector` turns a
 * joint angle crossing a rest threshold, holding, and crossing back into "one
 * rep", and every piece of `SessionEngine` exists to make that counting honest.
 * A held yoga pose has no repetition in it: the person is not moving, and the
 * thing being asked of them is to KEEP NOT MOVING in a particular shape. Running
 * a pose through the rep engine would produce a rep tally describing a movement
 * nobody made - the same failure `meditation-guidance.ts` documents for
 * meditation, and for the same reason.
 *
 * SO A POSE IS DESCRIBED ONLY BY WHAT 2D LANDMARKS CAN SETTLE
 * Every constraint below is a measurement of a landmark position or of an angle
 * between three of them, in the normalized image coordinates MediaPipe already
 * provides. There is deliberately:
 *
 *   - no depth, so nothing here can call a movement forward or backward;
 *   - no balance, because a 2D pose model cannot know whether a person is steady,
 *     and a claim about it would be invented rather than measured;
 *   - no alignment "in 3D", no twist, no comparison against the person's own
 *     earlier good frame beyond what the stillness gate in `yoga-hold.ts` does
 *     with time;
 *   - no claim that a pose is medically correct, safe, or therapeutic. A pose is
 *     "valid" here only in the narrow sense that the listed landmark checks all
 *     passed. NOVEN is a wellness app and says nothing about what is right for a
 *     particular person, their joints, or their treatment.
 *
 * WHY TOLERANCES ARE RATIOS AND BANDS, NOT PIXELS
 * Every threshold is either an angle in degrees, or a fraction of a dimension of
 * the person's OWN body measured in the same frame (torso length, shoulder
 * width). Nothing is an absolute distance in normalized image units. A person
 * standing further from the phone has a smaller torso in the image but the same
 * torso, so "the hips within 45% of torso length of the lower knee" means the
 * same thing at every distance. A fixed pixel threshold would quietly become a
 * different exercise for a person in a different place.
 *
 * ============================================================================
 * WHICH WAY THE PERSON MUST BE STANDING - AND WHY IT IS NOT ONE RULE FOR ALL
 * ============================================================================
 * A projected image hides some of the body and flattens some of it, and which way
 * somebody faces decides what survives. This was worked out from the geometry
 * rather than guessed, and it is the single most important thing in this file:
 *
 * A KNEE BEND BARELY EXISTS IN A FRONTAL VIEW.
 * Chair Pose and Warrior II both bend the knee, and a knee bend is mostly a
 * movement in DEPTH. Projected head-on, the hip travels straight down towards the
 * ankle and the knee comes towards the camera, so the three points stay almost in
 * a vertical line and the measured knee angle lands near 180 - indistinguishable
 * from standing. Measured from the side the same bend reads about 90, because the
 * thigh goes horizontal and the shin stays vertical.
 *
 * So the two bent-knee poses are measured from DIFFERENT directions, and each
 * says so in its own `guidance`, which is the sentence shown and spoken:
 *
 *   Chair Pose    - from the SIDE, where the knee angle is honest. Uses the angle.
 *   Warrior II    - from the FRONT, because the outstretched arms are the clearest
 *                   thing in the frame and fix the view. Uses the HEIGHT OF THE
 *                   HIPS relative to the lower knee, which does survive a frontal
 *                   projection, rather than a knee angle, which does not.
 *
 * A person who ignores the direction is told what to do by the app rather than
 * being quietly scored against a rule meant for a different view - and no
 * constraint in this file silently assumes a direction the pose's guidance has not
 * said out loud.
 */

/** The joints these rules are written in, named by side. */
export type YogaJoint = 'SHOULDER' | 'ELBOW' | 'WRIST' | 'HIP' | 'KNEE' | 'ANKLE';

/** Left/right, reused from the exercise layer so both sides speak one language. */
export type YogaSide = Side;

/** Maps a side plus a joint onto the landmark name the pose model reports. */
export function yogaLandmark(side: YogaSide, joint: YogaJoint): PoseLandmarkName {
  return `${side === 'left' ? 'LEFT' : 'RIGHT'}_${joint}` as PoseLandmarkName;
}

/**
 * Three joints, named without a side.
 *
 * Written side-free so one triplet can be evaluated against both legs, and so
 * "the left knee" is never hardcoded into a rule where the pose does not care
 * which side is which - which is the case for Warrior II's back leg, since the
 * app has no way to know which leg the person chose to lead with.
 */
export type YogaTriplet = { a: YogaJoint; b: YogaJoint; c: YogaJoint };

/**
 * How many sides of an angle check must satisfy it.
 *
 * `all` is for a shape both legs share (Mountain, Chair). `any` is for a shape
 * where ONE side satisfying it is the whole point - Warrior II's straight leg is
 * whichever one is not leading, and demanding both be straight would make the
 * person straighten the bent one too.
 */
export type YogaAngleMode = 'all' | 'any';

export type YogaAngleConstraint = {
  kind: 'angle';
  id: string;
  /** Degrees below which this check fails, when it has a floor. */
  minDeg?: number;
  /** Degrees above which this check fails, when it has a ceiling. */
  maxDeg?: number;
  triplet: YogaTriplet;
  sides: readonly YogaSide[];
  mode: YogaAngleMode;
  correction: string;
};

export type YogaTorsoLeanConstraint = {
  kind: 'torso-lean';
  id: string;
  /** Degrees of lean from vertical above which this check fails. */
  maxDeg: number;
  correction: string;
};

export type YogaBelowConstraint = {
  kind: 'below';
  id: string;
  /** The joint whose height is checked - a wrist resting by the hip, say. */
  point: YogaJoint;
  sides: readonly YogaSide[];
  correction: string;
};

export type YogaShoulderHeightConstraint = {
  kind: 'shoulder-height';
  id: string;
  point: YogaJoint;
  sides: readonly YogaSide[];
  /**
   * How far the joint may sit from shoulder height, as a fraction of the measured
   * torso length. 0.35 means "within about a third of your own torso".
   */
  maxOffsetRatio: number;
  correction: string;
};

export type YogaSeparationConstraint = {
  kind: 'horizontal-separation';
  id: string;
  left: YogaJoint;
  right: YogaJoint;
  /** Minimum separation as a multiple of the measured shoulder width. */
  minRatio: number;
  correction: string;
};

export type YogaHipToKneeHeightConstraint = {
  kind: 'hip-to-knee-height';
  id: string;
  /**
   * How near the hips must sit to the LOWER knee, as a fraction of torso length.
   *
   * The frontal-view stand-in for a bent knee: when the front thigh is near
   * horizontal the hips come down to knee level, and when standing they are well
   * above it. Measured standing this reads around 0.8; measured in Warrior II it
   * reads around 0.1. The two are nowhere near each other, so the threshold does
   * not have to be finely tuned to separate them.
   */
  maxOffsetRatio: number;
  correction: string;
};

export type YogaConstraint =
  | YogaAngleConstraint
  | YogaTorsoLeanConstraint
  | YogaBelowConstraint
  | YogaShoulderHeightConstraint
  | YogaSeparationConstraint
  | YogaHipToKneeHeightConstraint;

export type YogaPoseRuleId = 'mountain' | 'chair' | 'warrior-ii';

export type YogaPoseRule = {
  id: YogaPoseRuleId;
  /** What the HUD calls the pose. */
  name: string;
  /**
   * The plain-language setup line, and the one place a pose's required viewing
   * direction is stated. Read as the step's own guidance, so the person is told
   * which way to stand before the camera is asked to judge them from that angle.
   */
  guidance: string;
  /**
   * Every landmark the rule needs before it can say anything at all.
   *
   * Checked up front, so a pose never reports a correction that is really just
   * "I could not see you properly" - which would be an instruction to fix a
   * problem the person does not have.
   */
  requiredLandmarks: readonly PoseLandmarkName[];
  /**
   * The checks, in the order they are applied.
   *
   * Order is the priority order, and the FIRST failure is the one reported. It is
   * chosen so the most useful instruction comes first: for Chair Pose, being told
   * to bend the knees is more use than being told to straighten the back, which
   * is a consequence of the bend.
   */
  constraints: readonly YogaConstraint[];
  /**
   * How long the pose must be HELD - continuously valid - before it counts as
   * held. The settle time before this starts is not here; it belongs to the hold
   * tracker, which is the only thing that knows about time.
   */
  holdSeconds: number;
};

/**
 * Landmarks below this visibility are treated as not measured.
 *
 * The same figure the seated-posture check already uses, for the same reason: a
 * landmark the model is guessing at should not be allowed to decide whether
 * somebody is told to move.
 */
export const YOGA_MIN_VISIBILITY = 0.5;

/**
 * Upright tolerance for a STANDING pose.
 *
 * A standing person is held to a tighter figure than a seated one, because
 * standing upright is a deliberate posture and the shape being asked for is a
 * straight line from shoulder through hip. It is a single number applied to both
 * sides of the image, with no per-side tuning that could drift out of step.
 */
export const YOGA_STANDING_TORSO_LEAN_MAX_DEG = 20;

/** A little more forgiving for a pose that is deliberately bent at the hips. */
export const YOGA_BENT_TORSO_LEAN_MAX_DEG = 25;

/**
 * Both legs straight.
 *
 * 160 is short of a perfect 180 because a person holding still is never exactly
 * straight, and because the leg is measured in projection, where a leg turned even
 * slightly away from the camera foreshortens.
 */
export const YOGA_STRAIGHT_LEG_MIN_DEG = 160;

/**
 * The band a knee must fall inside to read as bent, for a pose seen from the side.
 *
 * Chair Pose puts the thigh near horizontal, which is near 90 at the knee.
 *
 * 135 at the top is the point at which the leg is straightening back out of the
 * pose rather than being in it. 60 at the bottom is well past any comfortable bend
 * and low enough that a fold nobody would attempt still passes, which keeps the
 * check from turning into a way of catching somebody out.
 */
export const YOGA_BENT_KNEE_MIN_DEG = 60;
export const YOGA_BENT_KNEE_MAX_DEG = 135;

/**
 * How near knee level the hips must be for a frontal-view bend to read as one.
 *
 * See `YogaHipToKneeHeightConstraint`. 0.45 sits between the two populations with
 * room on both sides: standing measures about 0.8 and Warrior II about 0.1, so
 * neither has to be hit accurately for the check to mean anything.
 */
export const YOGA_WARRIOR_HIP_KNEE_RATIO = 0.45;

/**
 * How near shoulder height an outstretched arm must be.
 *
 * Expressed as a fraction of the person's own torso length so it survives them
 * standing closer to or further from the phone.
 */
export const YOGA_ARM_AT_SHOULDER_RATIO = 0.35;

/**
 * How far apart the arms must be, in shoulder widths.
 *
 * A person's arm span is comfortably more than twice their shoulder width, so
 * asking for 1.6 is a modest, achievable reach rather than a lock-out. Below that
 * the arms are not out to the sides, which is the whole shape of Warrior II.
 */
export const YOGA_ARMS_SPREAD_MIN_RATIO = 1.6;

const ALL_SIDES: readonly YogaSide[] = ['left', 'right'];

/**
 * The three poses implemented in Phase 1.
 *
 * CHOSEN FOR WHAT THE CAMERA CAN SETTLE, NOT FOR HOW THEY LOOK
 * Each is a standing pose readable in 2D from the direction its own guidance
 * states, using the full 33-landmark set. Poses that genuinely need depth (Tree, and
 * the depth of any squat), twist, or a floor contact the model may not see
 * (Child's Pose, Downward Dog, Cobra) are deliberately absent rather than
 * approximated: a confident correction for a pose the camera cannot read would be
 * worse than not offering the pose at all.
 */
export const YOGA_POSE_RULES: Readonly<Record<YogaPoseRuleId, YogaPoseRule>> = {
  mountain: {
    id: 'mountain',
    name: 'Mountain Pose',
    guidance:
      'Stand facing the camera with your feet together and your arms resting by your sides.',
    requiredLandmarks: [
      'LEFT_SHOULDER',
      'RIGHT_SHOULDER',
      'LEFT_HIP',
      'RIGHT_HIP',
      'LEFT_KNEE',
      'RIGHT_KNEE',
      'LEFT_ANKLE',
      'RIGHT_ANKLE',
      'LEFT_WRIST',
      'RIGHT_WRIST',
    ],
    constraints: [
      {
        kind: 'torso-lean',
        id: 'mountain-upright',
        maxDeg: YOGA_STANDING_TORSO_LEAN_MAX_DEG,
        correction: 'Stand tall, shoulders over your hips',
      },
      {
        kind: 'angle',
        id: 'mountain-legs-straight',
        triplet: { a: 'HIP', b: 'KNEE', c: 'ANKLE' },
        minDeg: YOGA_STRAIGHT_LEG_MIN_DEG,
        sides: ALL_SIDES,
        mode: 'all',
        correction: 'Straighten both legs',
      },
      {
        kind: 'below',
        id: 'mountain-arms-down',
        point: 'WRIST',
        sides: ALL_SIDES,
        correction: 'Let your arms hang down by your sides',
      },
    ],
    holdSeconds: 20,
  },

  chair: {
    id: 'chair',
    name: 'Chair Pose',
    /*
     * "Turn to face sideways" is not decoration. The knee angle is the honest
     * measure of this pose and it only reads from the side - see the note at the
     * top of this file - so the direction is part of doing the pose correctly, not
     * a footnote. It is stated before the camera is asked to judge.
     */
    guidance:
      'Turn to face sideways, then bend your knees and sit your hips back, as if towards a chair.',
    requiredLandmarks: [
      'LEFT_SHOULDER',
      'RIGHT_SHOULDER',
      'LEFT_HIP',
      'RIGHT_HIP',
      'LEFT_KNEE',
      'RIGHT_KNEE',
      'LEFT_ANKLE',
      'RIGHT_ANKLE',
    ],
    constraints: [
      /*
       * The knee comes FIRST, deliberately. "Bend your knees" is the instruction
       * somebody needs; "keep your back straight" is something they will manage on
       * their own once the bend is right, and telling them to straighten up before
       * they have bent at all is the wrong order.
       */
      {
        kind: 'angle',
        id: 'chair-knees-bent',
        triplet: { a: 'HIP', b: 'KNEE', c: 'ANKLE' },
        minDeg: YOGA_BENT_KNEE_MIN_DEG,
        maxDeg: YOGA_BENT_KNEE_MAX_DEG,
        sides: ALL_SIDES,
        mode: 'all',
        correction: 'Bend your knees',
      },
      {
        kind: 'torso-lean',
        id: 'chair-upright',
        maxDeg: YOGA_BENT_TORSO_LEAN_MAX_DEG,
        correction: 'Keep your back straight as you bend',
      },
    ],
    holdSeconds: 15,
  },

  'warrior-ii': {
    id: 'warrior-ii',
    name: 'Warrior II',
    /*
     * "Face the camera" for the opposite reason to Chair Pose: the arms out to the
     * sides are the most reliable measurement in this pose and they only read from
     * the front, where the reach is across the image rather than towards it.
     */
    guidance:
      'Face the camera, step your feet apart, bend your front knee, and reach both arms out to the sides.',
    requiredLandmarks: [
      'LEFT_SHOULDER',
      'RIGHT_SHOULDER',
      'LEFT_HIP',
      'RIGHT_HIP',
      'LEFT_KNEE',
      'RIGHT_KNEE',
      'LEFT_ANKLE',
      'RIGHT_ANKLE',
      'LEFT_WRIST',
      'RIGHT_WRIST',
    ],
    constraints: [
      {
        /*
         * The bend, measured as hip height against the lower knee rather than as a
         * knee angle. This is the only frontal-view way to see it: the angle reads
         * near-straight from the front, and this reads 0.8 standing against 0.1 in
         * the pose.
         *
         * `lower` rather than a named side, because the app has no way of knowing
         * which leg the person is leading with and does not need to - it only needs
         * to know that one knee has come down towards hip level.
         */
        kind: 'hip-to-knee-height',
        id: 'warrior-front-knee-bent',
        maxOffsetRatio: YOGA_WARRIOR_HIP_KNEE_RATIO,
        correction: 'Bend your front knee until your hips come down to it',
      },
      {
        /*
         * `mode: 'any'` is what makes this Warrior II rather than a stricter
         * Mountain: whichever leg is not leading must be straight, and the app
         * identifies it as whichever one that is rather than being told.
         */
        kind: 'angle',
        id: 'warrior-back-leg-straight',
        triplet: { a: 'HIP', b: 'KNEE', c: 'ANKLE' },
        minDeg: YOGA_STRAIGHT_LEG_MIN_DEG,
        sides: ALL_SIDES,
        mode: 'any',
        correction: 'Straighten your back leg',
      },
      {
        kind: 'torso-lean',
        id: 'warrior-upright',
        maxDeg: YOGA_BENT_TORSO_LEAN_MAX_DEG,
        correction: 'Stand tall through your spine',
      },
      {
        kind: 'shoulder-height',
        id: 'warrior-arms-level',
        point: 'WRIST',
        sides: ALL_SIDES,
        maxOffsetRatio: YOGA_ARM_AT_SHOULDER_RATIO,
        correction: 'Reach your arms out level with your shoulders',
      },
      {
        kind: 'horizontal-separation',
        id: 'warrior-arms-spread',
        left: 'WRIST',
        right: 'WRIST',
        minRatio: YOGA_ARMS_SPREAD_MIN_RATIO,
        correction: 'Reach both arms out to the sides',
      },
    ],
    holdSeconds: 20,
  },
};

/** The rule for a pose id, or undefined when the id is not one we implement. */
export function getYogaPoseRule(id?: string | string[] | null): YogaPoseRule | undefined {
  const key = Array.isArray(id) ? id[0] : id;
  if (typeof key !== 'string' || key.length === 0) return undefined;
  return Object.prototype.hasOwnProperty.call(YOGA_POSE_RULES, key)
    ? YOGA_POSE_RULES[key as YogaPoseRuleId]
    : undefined;
}

/** True when the value is one of the implemented pose ids. */
export function isYogaPoseRuleId(value: unknown): value is YogaPoseRuleId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(YOGA_POSE_RULES, value);
}