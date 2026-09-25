import type { ExerciseConfig } from './types';

/**
 * Seated Knee Extension — NOVEN's first fully pose-tracked movement.
 *
 * The user sits in a chair, holds the seat, and alternately straightens each
 * knee until the leg is level with the hip, then lowers it slowly.
 *
 * Geometry: the tracked joint is the KNEE. A seated knee starts bent at ~90°
 * and becomes ~180° when the leg is straight. The detector watches the hip →
 * knee → ankle angle on BOTH legs (the exercise alternates sides) and counts a
 * rep each time a leg goes from bent, to straight (held), and back to bent.
 *
 * Thresholds are deliberately forgiving for an elderly beginner: the knee does
 * not need to lock at a perfect 180° and the movement can be fairly compact.
 */
export const SEATED_KNEE_EXTENSION: ExerciseConfig = {
  id: 'seated-knee-extension',
  name: 'Seated Knee Extension',
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
    /** At or below this angle the knee is considered bent (rest). */
    bentAngleDeg: 140,
    /** At or above this angle the knee is considered straight (extended). */
    extendedAngleDeg: 160,
    /** Cycle must move at least this many degrees to count as a rep. */
    minRangeDeg: 25,
    /** Ignore a new rep that finishes within this window of the last one. */
    minRepIntervalMs: 700,
    /** Frames the machine must hold a phase before committing to it. */
    holdFrames: 2,
    /** Landmarks below this visibility are ignored for distance metrics. */
    minVisibility: 0.4,
  },
};