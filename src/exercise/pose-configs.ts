import { SEATED_KNEE_EXTENSION } from './configs';
import type { ExerciseConfig } from './types';

/**
 * ============================================================================
 * Registry of the exercises NOVEN can actually track with the camera.
 * ============================================================================
 *
 * WHY THIS IS A SEPARATE FILE
 * `configs.ts` holds NOVEN's first pose-tracked movement and is treated as
 * frozen logic: the thresholds in it were derived from a seated knee extension
 * filmed from the side, and nothing here may quietly retune them. So the
 * additional movements live beside it rather than inside it, and this module
 * simply re-exports the whole set by catalogue id. Adding a movement means
 * adding a config here; it never means editing the one that works.
 *
 * WHY A REGISTRY AND NOT A FLAG ON THE CATALOGUE
 * "Is this exercise camera-tracked?" is decided by whether a config exists for
 * it, not by a field someone has to remember to set. A catalogue entry with no
 * config is therefore a guided item by construction, and there is no state in
 * which the app offers a camera session it has no thresholds for.
 *
 * WHAT A CONFIG HAS TO MEAN HERE
 * `SessionEngine` derives everything else from the config: the joints the
 * readiness gate watches, the body anchor that catches the person walking away,
 * and the angle bands a rep cycle must cross. So a new movement is honest if
 * and only if its `triplets` point at joints whose angle really does travel
 * between the two bands, and its `readiness` is honest if the starting posture
 * the user is asked to hold really is the low-angle one.
 */

/**
 * Seated Arm Raise — the upper-body counterpart to the seated knee extension.
 *
 * Geometry: the tracked joint is the SHOULDER. `AngleTriplet` names its middle
 * point `knee` because the knee was the first joint tracked, and the field is
 * positional rather than anatomical: `calculateAngle(hip, knee, ankle)` always
 * measures at the middle landmark. Putting the shoulder in that slot and the
 * elbow in the last one measures hip -> shoulder -> elbow, i.e. the angle the
 * arm makes with the torso. Keeping the real hip in the FIRST slot is what
 * makes the readiness gate's body anchor the hips, which is correct: a raised
 * arm must not be mistaken for the whole body moving.
 *
 * In the side view this app uses, the arm is raised forward and up. Hanging
 * down, the elbow sits below the shoulder and the angle to the hip is roughly
 * 10-25deg. Straight forward it is about 90deg, and above the shoulder it
 * passes 140deg. So the bands below put "arms down" in the rest regime and
 * "raised above the shoulders" in the extended one, with 60deg of required
 * travel so an incidental shift of the arm cannot complete a rep.
 */
export const SEATED_ARM_RAISE: ExerciseConfig = {
  id: 'seated-arm-raise',
  name: 'Seated Arm Raise',
  sides: ['left', 'right'],
  triplets: {
    left: {
      hip: 'LEFT_HIP',
      knee: 'LEFT_SHOULDER',
      ankle: 'LEFT_ELBOW',
    },
    right: {
      hip: 'RIGHT_HIP',
      knee: 'RIGHT_SHOULDER',
      ankle: 'RIGHT_ELBOW',
    },
  },
  thresholds: {
    /** At or below this the arms are down at the sides (rest). */
    bentAngleDeg: 45,
    /** At or above this the arms are raised above the shoulders (extended). */
    extendedAngleDeg: 120,
    /**
     * 60deg of travel, far more than the seated knee extension's 25deg. A
     * shoulder this mobile produces small angle changes from ordinary posture
     * and from the arm settling against the body, and a loose threshold here
     * would count a person shifting in their chair as a repetition. Requiring
     * the arm to travel from below 45deg to above 120deg is the movement the
     * instructions actually ask for.
     */
    minRangeDeg: 60,
    /**
     * Longer than the knee's 700ms. A raise and lower is a bigger movement
     * than a knee extension, so allowing less time between counted reps would
     * let the two arms of one person be counted as two movements rather than
     * one.
     */
    minRepIntervalMs: 900,
    holdFrames: 2,
    minVisibility: 0.4,
    maxFrameGapMs: 1000,
  },
  readiness: {
    minVisibility: 0.4,
    maxStableDrift: 0.03,
    minStableFrames: 10,
    minStableMs: 1000,
    /**
     * The hips do not move during a seated arm raise, so the anchor limits are
     * the same as the seated knee extension's. That is the point: the gate
     * watches the hips, and the arms are free to travel.
     */
    maxAnchorDrift: 0.04,
    anchorDriftSuspendFrames: 2,
    maxAnchorOffset: 0.12,
    /**
     * Arms down is a low shoulder angle, so the same resting-posture requirement
     * applies: counting starts from the posture the instructions ask the user to
     * adopt, not from whatever the camera happens to be pointing at.
     */
    requireRestingPosture: true,
  },
};

/**
 * Sit-to-Stand — the same knee-angle cycle as the seated knee extension, done
 * from a chair to standing and back.
 *
 * The tracked joint is the KNEE, and the angle genuinely travels the same way:
 * roughly 95deg seated, 170deg or more standing. A rep is one stand and one
 * sit back down.
 *
 * WHY THE ANCHOR IS MUCH LOOSER THAN THE SEATED EXERCISES
 * Every other config here assumes the hips stay on the chair. This one cannot:
 * standing moves the hip midpoint up by roughly a fifth of the frame, which is
 * more than twice the 0.12 used by the seated configs, so a seated-sized limit
 * would read a single correct repetition as the person walking away and suspend
 * counting on every rep. 0.35 admits the movement the exercise is named after
 * while still rejecting what it is actually there to catch — a person getting up
 * and walking to the phone, which travels the same order of distance but ends
 * somewhere the session does not continue.
 *
 * The per-frame drift limit is left tight on purpose. Standing is a slow,
 * continuous rise, so the hips never move fast enough in one frame to look like
 * a walk; a person striding toward the camera still trips it immediately.
 */
export const SIT_TO_STAND: ExerciseConfig = {
  id: 'sit-to-stand',
  name: 'Sit-to-Stand',
  sides: ['left', 'right'],
  triplets: {
    left: {
      hip: 'LEFT_HIP',
      knee: 'LEFT_KNEE',
      ankle: 'LEFT_ANKLE',
    },
    right: {
      hip: 'RIGHT_HIP',
      knee: 'RIGHT_KNEE',
      ankle: 'RIGHT_ANKLE',
    },
  },
  thresholds: {
    bentAngleDeg: 140,
    /** A standing knee is nearly straight, and must actually be held there. */
    extendedAngleDeg: 165,
    /**
     * 45deg rather than the seated exercise's 25deg. Sitting down in a chair
     * does not bend the knee to 90deg the way a seated leg extension does — it
     * leaves it wherever the chair height puts it, often 100-120deg — so a
     * 25deg cycle would be satisfied by an ordinary small shift of weight
     * rather than by standing up.
     */
    minRangeDeg: 45,
    /** Standing and sitting back down takes seconds, not fractions of one. */
    minRepIntervalMs: 1500,
    holdFrames: 2,
    minVisibility: 0.4,
    maxFrameGapMs: 1000,
  },
  readiness: {
    minVisibility: 0.4,
    maxStableDrift: 0.03,
    minStableFrames: 10,
    minStableMs: 1000,
    /**
     * Looser than the seated configs because the exercise moves the whole body
     * on purpose; see the note above. Still far below the distance a person
     * covers by approaching or leaving the phone.
     */
    maxAnchorDrift: 0.05,
    anchorDriftSuspendFrames: 2,
    maxAnchorOffset: 0.35,
    /**
     * The exercise starts from sitting, which is a bent knee, so the resting
     * posture requirement is the same one the seated knee extension uses.
     */
    requireRestingPosture: true,
  },
};

/**
 * Every camera-tracked movement, by the id used in the exercise catalogue.
 *
 * A plain object rather than a Map so the set is literal and greppable, and so a
 * config whose id disagrees with its catalogue entry is a visible mistake
 * rather than a lookup that quietly returns undefined.
 */
const POSE_CONFIGS: Readonly<Record<string, ExerciseConfig>> = {
  [SEATED_KNEE_EXTENSION.id]: SEATED_KNEE_EXTENSION,
  [SEATED_ARM_RAISE.id]: SEATED_ARM_RAISE,
  [SIT_TO_STAND.id]: SIT_TO_STAND,
};

/** All camera-tracked configs, for tests and for the exercise detail screen. */
export const poseTrackedConfigs: readonly ExerciseConfig[] = Object.values(POSE_CONFIGS);

function firstId(id?: string | string[] | null): string | null {
  const key = Array.isArray(id) ? id[0] : id;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * The config for a catalogue id, or undefined when the exercise is not
 * camera-tracked. Accepts the raw `useLocalSearchParams` shape, which is either a
 * string or an array of strings depending on the platform and navigation state,
 * so no caller has to normalise it first.
 */
export function getExerciseConfig(id?: string | string[] | null): ExerciseConfig | undefined {
  const key = firstId(id);
  if (key === null) return undefined;
  return POSE_CONFIGS[key];
}

/** True when NOVEN has real camera thresholds for this exercise. */
export function isPoseTracked(id?: string | string[] | null): boolean {
  return getExerciseConfig(id) !== undefined;
}
