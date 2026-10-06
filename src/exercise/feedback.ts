import type { PosePresence } from '../../modules/pose-tracker';

import type { ReadinessPhase } from './stabilize';
import type { RepPhase } from './types';

/**
 * Elderly-friendly, plain-language feedback. These strings are deliberately
 * simple, calm, and free of clinical or technical language. The returned tone
 * maps to the NOVEN StatusChip color so the feedback reads as either a neutral
 * hint, an active instruction, or a positive reinforcement.
 */
export type FeedbackTone = 'ready' | 'accent' | 'sage';

/**
 * The semantic identity of a cue, independent of its wording.
 *
 * `text` is what the HUD shows; `kind` is what the voice layer reacts to. Keeping
 * both on the same object is what guarantees the screen and the speaker can never
 * disagree — there is exactly one decision per frame, produced by the session
 * engine, and both consumers read it. The voice layer never re-derives state and
 * never pattern-matches on the English text.
 *
 * These map 1:1 onto states the pipeline already produces. There is deliberately
 * no "too close" / "too far" kind: the engine has no distance estimate, and
 * inventing one purely to drive speech would be a fabricated signal.
 */
export type FeedbackKind =
  /** Pre-Start coaching, before the session exists. */
  | 'setup'
  /** Person not visible to the camera. */
  | 'position'
  /** Visible, but not yet in a countable posture. */
  | 'positioning'
  /** Visible and in frame, holding still to earn readiness. */
  | 'stabilizing'
  /** Counting is enabled and the legs are at rest. */
  | 'ready'
  /** The movement is travelling away from where it started. */
  | 'extend'
  /** The movement reached the end of its range and is being held. */
  | 'hold'
  /** The movement is coming back. */
  | 'return'
  /** A rep was just counted (held on screen by the latch below). */
  | 'good'
  /** The session is suspended. */
  | 'paused'
  /** The session is over and terminal. */
  | 'completed';

export type FeedbackCue = {
  text: string;
  tone: FeedbackTone;
  kind: FeedbackKind;
};

function cue(text: string, tone: FeedbackTone, kind: FeedbackKind): FeedbackCue {
  return { text, tone, kind };
}

/** Feedback when the model has no usable pose or the person is not visible. */
export function presenceFeedback(_presence: PosePresence): FeedbackCue {
  return cue('Move into the camera view', 'accent', 'position');
}

/**
 * Coaching cue shown before the session starts, while the user is still
 * setting up. Mirrors the pre-Start state of the flow.
 */
export function setupFeedback(): FeedbackCue {
  return cue('Position yourself in the frame', 'accent', 'setup');
}

/**
 * Coaching cue for the pre-count readiness gate. Returns the live phase cue so
 * the HUD always has something instructive to show: waiting asks the user to
 * sit properly, stabilizing asks for stillness, and ready confirms counting may
 * begin.
 */
export function readinessFeedback(phase: ReadinessPhase): FeedbackCue {
  switch (phase) {
    case 'waiting':
      return cue('Get into position', 'accent', 'positioning');
    case 'stabilizing':
      return cue('Get ready', 'accent', 'stabilizing');
    case 'ready':
      return cue('Ready', 'ready', 'ready');
  }
}

/** Coaching cue shown while the session is paused. */
export function pausedFeedback(): FeedbackCue {
  return cue('Paused', 'ready', 'paused');
}

/**
 * Terminal cue for a finished session. The engine deliberately does not emit this
 * (it goes inert on end()); the screen raises it once so the HUD and the voice
 * share one description of the completed state.
 */
export function completedFeedback(): FeedbackCue {
  return cue('Session complete', 'ready', 'completed');
}

/**
 * Merges the two leg phases into one coaching cue. The most instructive phase
 * wins: an active return ("slow down") beats instructing the other leg to
 * extend, which beats a held extension or a resting leg.
 */
export function priorityPhase(left: RepPhase, right: RepPhase): RepPhase {
  if (left === 'returning' || right === 'returning') return 'returning';
  if (left === 'extending' || right === 'extending') return 'extending';
  if (left === 'extended' || right === 'extended') return 'extended';
  return 'rest';
}

/**
 * The wording a live cue uses for one movement.
 *
 * Only the three phase strings vary. `FeedbackKind` does NOT: the voice layer
 * reacts to the kind, so the screen and the speaker keep agreeing on what is
 * happening while the words follow the movement.
 */
export type MovementWording = {
  extend: string;
  hold: string;
  return: string;
};

/**
 * What is said when nothing is known about the movement.
 *
 * This is the default on purpose. `phaseFeedback` used to say "Extend your
 * knee" unconditionally, which was true for exactly one of the movements NOVEN
 * offers and wrong for every other one, so a person doing a neck stretch was
 * told to straighten their leg. When the movement is not identified, the honest
 * thing to say is something that is true of any of them.
 */
const NEUTRAL_WORDING: MovementWording = {
  extend: 'Move slowly',
  hold: 'Hold it there',
  return: 'Come back slowly',
};

/**
 * How each camera movement is described, keyed by the config id that already
 * identifies it.
 *
 * The ids are the ones `ExerciseConfig.id` already carries, so nothing new is
 * invented to tell the movements apart: the session engine already holds the
 * config, and the guided screen already resolves a step to one. A movement that
 * is absent from this table gets `NEUTRAL_WORDING`, which means adding a
 * movement can never silently inherit someone else's instructions.
 *
 * These are descriptions of the movement being performed, not advice about it.
 * NOVEN is a wellness app and says nothing here about what is correct for a
 * particular person, their joints, or their treatment.
 */
const MOVEMENT_WORDING: Readonly<Record<string, MovementWording>> = {
  // The one movement the knee wording was ever written for.
  'seated-knee-extension': {
    extend: 'Extend your knee',
    hold: 'Keep it straight',
    return: 'Return slowly',
  },
  'seated-arm-raise': {
    extend: 'Lift your arm',
    hold: 'Hold it there',
    return: 'Lower slowly',
  },
  'sit-to-stand': {
    extend: 'Stand up slowly',
    hold: 'Hold it there',
    return: 'Sit down slowly',
  },
  'yoga-neck-extension': {
    extend: 'Look up slowly',
    hold: 'Hold it there',
    return: 'Look forward slowly',
  },
  'yoga-shoulder-flexion': {
    extend: 'Lift your arms',
    hold: 'Hold it there',
    return: 'Lower slowly',
  },
  'yoga-trunk-lateral-flexion': {
    extend: 'Bend to one side',
    hold: 'Hold it there',
    return: 'Come back slowly',
  },
  'yoga-trunk-forward-flexion': {
    extend: 'Bend forward',
    hold: 'Hold it there',
    return: 'Come back slowly',
  },
  'yoga-seated-hip-flexion': {
    extend: 'Lift your knee',
    hold: 'Hold it there',
    return: 'Lower slowly',
  },
};

/** The wording for a movement, or neutral wording when it is not a known one. */
export function movementWording(movementId?: string): MovementWording {
  return (movementId !== undefined && MOVEMENT_WORDING[movementId]) || NEUTRAL_WORDING;
}

/**
 * Live coaching cue from the rep phase machine.
 *
 * `movementId` is the config id of the movement being performed, which the
 * session engine already knows. Without it the cue stays generic on purpose:
 * a phase cannot tell you which body part is moving, so it must not claim to.
 */
export function phaseFeedback(
  phase: RepPhase,
  completedThisFrame: boolean,
  movementId?: string,
): FeedbackCue {
  if (completedThisFrame) return cue('Good movement', 'sage', 'good');

  const wording = movementWording(movementId);

  switch (phase) {
    case 'rest':
      return cue('Ready', 'ready', 'ready');
    case 'extending':
      return cue(wording.extend, 'accent', 'extend');
    case 'extended':
      return cue(wording.hold, 'sage', 'hold');
    case 'returning':
      return cue(wording.return, 'accent', 'return');
  }
}

/**
 * Holds the positive reinforcement on screen after a rep is counted.
 *
 * `phaseFeedback` reports "Good movement" only on the exact frame the rep
 * completes. Pose frames arrive every ~33-100ms, so that single-frame cue is
 * effectively invisible: it flashes and is replaced by the next phase cue
 * before an older user can read it, which reads as flicker rather than praise.
 *
 * This latch is keyed on the rep phase instead of a timer, so it is
 * deterministic and frame-rate independent: the positive cue is held for exactly
 * as long as the legs are still in the phase they were in when the rep
 * completed, and released the moment they move again. No arbitrary duration, no
 * clock, nothing that can leave a stale "Good movement" on screen.
 */
export class PositiveFeedbackLatch {
  /** Rep phase observed on the frame a rep completed; null when not latched. */
  private heldPhase: RepPhase | null = null;

  /**
   * Feeds the merged rep phase for this frame. Returns true while the positive
   * cue should be shown. Set `repCompletedThisFrame` on the frame a rep counted.
   */
  observe(phase: RepPhase, repCompletedThisFrame: boolean): boolean {
    if (repCompletedThisFrame) this.heldPhase = phase;
    // The legs moved on: whatever the positive cue was praising is over.
    if (this.heldPhase !== null && this.heldPhase !== phase) this.heldPhase = null;
    return this.heldPhase !== null;
  }

  /** Releases the cue (session start, pause, end, tracking loss). */
  clear(): void {
    this.heldPhase = null;
  }
}
