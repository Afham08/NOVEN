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
 * Camera-tracked yoga poses.
 *
 * These are individual pose configurations that can be used within a guided
 * yoga routine. Each tracks a specific joint angle that MediaPipe can reliably
 * measure from a side view.
 */

/**
 * Neck Extension — "Look Up" pose.
 * Tracks the angle from shoulder to nose (cervical extension).
 * Rest: chin tucked (~20-30 deg), Extended: looking up (~70-90 deg).
 */
export const NECK_EXTENSION: ExerciseConfig = {
  id: 'yoga-neck-extension',
  name: 'Neck Extension (Look Up)',
  sides: ['left', 'right'],
  triplets: {
    left: {
      hip: 'LEFT_SHOULDER',
      knee: 'NOSE',
      ankle: 'LEFT_EAR',
    },
    right: {
      hip: 'RIGHT_SHOULDER',
      knee: 'NOSE',
      ankle: 'RIGHT_EAR',
    },
  },
  thresholds: {
    /** Chin tucked toward chest. */
    bentAngleDeg: 30,
    /** Looking up, neck extended. */
    extendedAngleDeg: 75,
    /** Minimum range for a valid movement. */
    minRangeDeg: 25,
    /** Time between reps - slow movement. */
    minRepIntervalMs: 2000,
    holdFrames: 3,
    minVisibility: 0.5,
    maxFrameGapMs: 1500,
  },
  readiness: {
    minVisibility: 0.5,
    maxStableDrift: 0.02,
    minStableFrames: 15,
    minStableMs: 1500,
    maxAnchorDrift: 0.03,
    anchorDriftSuspendFrames: 2,
    maxAnchorOffset: 0.1,
    /** Starting with chin slightly tucked. */
    requireRestingPosture: true,
  },
};

/**
 * Shoulder Flexion — "Reach Up" / "Open Arms" pose.
 * Tracks shoulder angle (hip -> shoulder -> elbow).
 * Rest: arms down (~10-25 deg), Extended: arms overhead (~140-160 deg).
 */
export const SHOULDER_FLEXION: ExerciseConfig = {
  id: 'yoga-shoulder-flexion',
  name: 'Shoulder Flexion (Reach Up)',
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
    /** Arms relaxed at sides. */
    bentAngleDeg: 30,
    /** Arms raised overhead. */
    extendedAngleDeg: 140,
    minRangeDeg: 50,
    minRepIntervalMs: 2000,
    holdFrames: 3,
    minVisibility: 0.4,
    maxFrameGapMs: 1500,
  },
  readiness: {
    minVisibility: 0.4,
    maxStableDrift: 0.03,
    minStableFrames: 10,
    minStableMs: 1000,
    maxAnchorDrift: 0.04,
    anchorDriftSuspendFrames: 2,
    maxAnchorOffset: 0.12,
    /** Arms down at rest. */
    requireRestingPosture: true,
  },
};

/**
 * Trunk Lateral Flexion — "Side Bend" pose.
 * Tracks trunk angle (shoulder -> hip -> knee... approximated via shoulder-hip line).
 * Using shoulder midpoint to hip midpoint angle relative to vertical.
 * Rest: upright (~0-10 deg), Extended: side bend (~25-35 deg).
 */
export const TRUNK_LATERAL_FLEXION: ExerciseConfig = {
  id: 'yoga-trunk-lateral-flexion',
  name: 'Trunk Lateral Flexion (Side Bend)',
  sides: ['left', 'right'],
  triplets: {
    left: {
      hip: 'LEFT_SHOULDER',
      knee: 'LEFT_HIP',
      ankle: 'LEFT_KNEE',
    },
    right: {
      hip: 'RIGHT_SHOULDER',
      knee: 'RIGHT_HIP',
      ankle: 'RIGHT_KNEE',
    },
  },
  thresholds: {
    /** Upright posture. */
    bentAngleDeg: 10,
    /** Side bend achieved. */
    extendedAngleDeg: 30,
    minRangeDeg: 15,
    minRepIntervalMs: 3000,
    holdFrames: 5,
    minVisibility: 0.4,
    maxFrameGapMs: 2000,
  },
  readiness: {
    minVisibility: 0.4,
    maxStableDrift: 0.03,
    minStableFrames: 15,
    minStableMs: 2000,
    maxAnchorDrift: 0.03,
    anchorDriftSuspendFrames: 3,
    maxAnchorOffset: 0.15,
    requireRestingPosture: true,
  },
};

/**
 * Trunk Forward Flexion — "Forward Fold" / "Hands to Feet" pose.
 * Tracks hip angle (shoulder -> hip -> knee).
 * Rest: upright (~170-180 deg), Folded: forward bend (~90-110 deg).
 */
export const TRUNK_FORWARD_FLEXION: ExerciseConfig = {
  id: 'yoga-trunk-forward-flexion',
  name: 'Trunk Forward Flexion (Forward Fold)',
  sides: ['left', 'right'],
  triplets: {
    left: {
      hip: 'LEFT_SHOULDER',
      knee: 'LEFT_HIP',
      ankle: 'LEFT_KNEE',
    },
    right: {
      hip: 'RIGHT_SHOULDER',
      knee: 'RIGHT_HIP',
      ankle: 'RIGHT_KNEE',
    },
  },
  thresholds: {
    /** Upright sitting/standing. */
    bentAngleDeg: 165,
    /** Forward fold achieved. */
    extendedAngleDeg: 100,
    minRangeDeg: 40,
    minRepIntervalMs: 3000,
    holdFrames: 5,
    minVisibility: 0.4,
    maxFrameGapMs: 2000,
  },
  readiness: {
    minVisibility: 0.4,
    maxStableDrift: 0.03,
    minStableFrames: 15,
    minStableMs: 2000,
    maxAnchorDrift: 0.03,
    anchorDriftSuspendFrames: 3,
    maxAnchorOffset: 0.15,
    requireRestingPosture: true,
  },
};

/**
 * Hip Flexion (Seated March) — "March on the Spot" pose.
 * Tracks knee angle (hip -> knee -> ankle) for seated marching.
 * Rest: knee bent (~90-100 deg), Extended: knee lifted (~60-75 deg).
 */
export const SEATED_HIP_FLEXION: ExerciseConfig = {
  id: 'yoga-seated-hip-flexion',
  name: 'Seated Hip Flexion (March)',
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
    /** Foot on floor, knee bent. */
    bentAngleDeg: 100,
    /** Knee lifted toward chest. */
    extendedAngleDeg: 70,
    minRangeDeg: 20,
    minRepIntervalMs: 1500,
    holdFrames: 3,
    minVisibility: 0.4,
    maxFrameGapMs: 1500,
  },
  readiness: {
    minVisibility: 0.4,
    maxStableDrift: 0.03,
    minStableFrames: 10,
    minStableMs: 1000,
    maxAnchorDrift: 0.04,
    anchorDriftSuspendFrames: 2,
    maxAnchorOffset: 0.12,
    requireRestingPosture: true,
  },
};

/**
 * Camera-tracked exercise configs only (for the exercise catalogue).
 *
 * These are the movements that appear in the exercise list and have dedicated
 * session screens with full rep counting and metrics.
 */
const EXERCISE_POSE_CONFIGS: Readonly<Record<string, ExerciseConfig>> = {
  [SEATED_KNEE_EXTENSION.id]: SEATED_KNEE_EXTENSION,
  [SEATED_ARM_RAISE.id]: SEATED_ARM_RAISE,
  [SIT_TO_STAND.id]: SIT_TO_STAND,
};

/**
 * Camera-tracked guided activity configs (for Yoga/Meditation steps).
 *
 * These are individual pose configurations used within guided activities.
 * They are NOT listed in the exercise catalogue and do not have dedicated
 * session screens. They are used by the guided activity screen for specific
 * steps that support camera guidance.
 */
const GUIDED_POSE_CONFIGS: Readonly<Record<string, ExerciseConfig>> = {
  [NECK_EXTENSION.id]: NECK_EXTENSION,
  [SHOULDER_FLEXION.id]: SHOULDER_FLEXION,
  [TRUNK_LATERAL_FLEXION.id]: TRUNK_LATERAL_FLEXION,
  [TRUNK_FORWARD_FLEXION.id]: TRUNK_FORWARD_FLEXION,
  [SEATED_HIP_FLEXION.id]: SEATED_HIP_FLEXION,
};

/**
 * All camera-tracked exercise configs, for tests and the exercise detail screen.
 */
export const poseTrackedConfigs: readonly ExerciseConfig[] = Object.values(EXERCISE_POSE_CONFIGS);

/**
 * All camera-tracked guided activity configs, for the guided activity screen.
 */
export const guidedPoseTrackedConfigs: readonly ExerciseConfig[] = Object.values(GUIDED_POSE_CONFIGS);

function firstId(id?: string | string[] | null): string | null {
  const key = Array.isArray(id) ? id[0] : id;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * The config for an exercise catalogue id, or undefined when the exercise is not
 * camera-tracked. Accepts the raw `useLocalSearchParams` shape.
 */
export function getExerciseConfig(id?: string | string[] | null): ExerciseConfig | undefined {
  const key = firstId(id);
  if (key === null) return undefined;
  return EXERCISE_POSE_CONFIGS[key];
}

/**
 * The config for a guided activity camera config id, or undefined.
 * Used by the guided activity screen for camera-tracked steps.
 */
export function getGuidedPoseConfig(id?: string | string[] | null): ExerciseConfig | undefined {
  const key = firstId(id);
  if (key === null) return undefined;
  return GUIDED_POSE_CONFIGS[key];
}

/** True when NOVEN has real camera thresholds for this exercise. */
export function isPoseTracked(id?: string | string[] | null): boolean {
  return getExerciseConfig(id) !== undefined;
}

/** True when a guided activity step has camera tracking available. */
export function isGuidedPoseTracked(id?: string | string[] | null): boolean {
  return getGuidedPoseConfig(id) !== undefined;
}
