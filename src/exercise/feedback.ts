import type { PosePresence } from '../../modules/pose-tracker';

import type { RepPhase } from './types';

/**
 * Elderly-friendly, plain-language feedback. These strings are deliberately
 * simple, calm, and free of clinical or technical language. The returned tone
 * maps to the NOVEN StatusChip color so the feedback reads as either a neutral
 * hint, an active instruction, or a positive reinforcement.
 */
export type FeedbackTone = 'ready' | 'accent' | 'sage';

export type FeedbackCue = {
  text: string;
  tone: FeedbackTone;
};

function cue(text: string, tone: FeedbackTone): FeedbackCue {
  return { text, tone };
}

/** Feedback when the model has no usable pose or the person is not visible. */
export function presenceFeedback(_presence: PosePresence): FeedbackCue {
  return cue('Move into the camera view', 'accent');
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

/** Live coaching cue from the rep phase machine. */
export function phaseFeedback(phase: RepPhase, completedThisFrame: boolean): FeedbackCue {
  if (completedThisFrame) return cue('Good movement', 'sage');

  switch (phase) {
    case 'rest':
      return cue('Ready', 'ready');
    case 'extending':
      return cue('Extend your knee', 'accent');
    case 'extended':
      return cue('Keep it straight', 'sage');
    case 'returning':
      return cue('Return slowly', 'accent');
  }
}