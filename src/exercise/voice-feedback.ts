/**
 * Voice feedback for the guided session.
 *
 * The user is exercising several feet from the phone, so the session also has to
 * be followable by ear. This module is deliberately split in two:
 *
 *     SessionEngine decision  ->  FeedbackCue.kind  ->  VoiceFeedbackController
 *                                                        |
 *                                                        v
 *                                                  SpeechSink (expo-speech)
 *
 * The controller is where ALL the throttling lives, and it takes only its sink
 * by injection — there is no clock, because whether a cue may be spoken is a
 * pure function of the previous cue kind and the current one. That is what makes
 * every rule below — state-transition dedupe, priority, one-announcement-per-rep,
 * silence-while-paused — testable in Node, with no Android and no real
 * text-to-speech engine involved.
 *
 * Two rules shape the whole design:
 *
 *  1. The pose callback must never block. `onFrame` is synchronous, allocation
 *     free on the hot path, and calls into a fire-and-forget sink. Nothing here
 *     is awaited, so speaking can never slow the rep pipeline down.
 *
 *  2. Speaking is driven by *decisions*, never by rendered values. A rep is
 *     announced only when the engine reports `repCompletedThisFrame` — the
 *     detector's own completion event. A re-render, a route parameter, or a HUD
 *     update can therefore never invent a rep announcement.
 */

import type { FeedbackCue, FeedbackKind } from './feedback';

/** Higher priority may cut off lower priority speech. */
export type SpeechPriority = 'low' | 'normal' | 'high';

/** The native boundary. Everything above this line is pure and testable. */
export type SpeechSink = {
  speak(text: string, options: { priority: SpeechPriority; interrupt: boolean }): void;
  stop(): void;
};

/** How a given kind of cue is allowed to reach the speaker. */
type KindPolicy = {
  priority: SpeechPriority;
  /** Cut off whatever is currently being spoken. */
  interrupt: boolean;
};

/**
 * The three states that mean "the user cannot be counted right now", and the
 * only ones that speak on their own during a session.
 *
 * They are treated as ONE family for announcement purposes, because they are
 * three phases of a single underlying problem — the person is not yet in a
 * countable posture. A single occluded or noisy frame legitimately flips the
 * readiness gate between `positioning` and `stabilizing`; keying the
 * announcement on the individual phase would produce
 *
 *     "Move into position." / "Hold still." / "Move into position." / "Hold still."
 *
 * for one single unsettled pose, which is exactly the setup spam this policy
 * exists to prevent. See consider().
 */
const SETUP_KINDS: ReadonlySet<FeedbackKind> = new Set<FeedbackKind>([
  'position',
  'positioning',
  'stabilizing',
]);

function isSetupKind(kind: FeedbackKind | null): boolean {
  return kind !== null && SETUP_KINDS.has(kind);
}

/**
 * `position` is a genuine, model-level presence loss: the person is not in the
 * frame at all. Any praise still playing describes a rep the user can no longer
 * be doing, so it is actively misleading and this one cue cuts it off.
 *
 * `positioning` and `stabilizing` are deliberately NOT interrupting. They mean
 * the posture is not countable *yet*, which a single transient frame can cause,
 * so they must not cut off a rep confirmation or a session transition the user
 * is actually waiting to hear. They speak once, at normal priority, and queue
 * behind whatever is playing.
 */
const POLICY: Record<FeedbackKind, KindPolicy> = {
  setup: { priority: 'normal', interrupt: false },
  position: { priority: 'high', interrupt: true },
  positioning: { priority: 'normal', interrupt: false },
  stabilizing: { priority: 'normal', interrupt: false },
  ready: { priority: 'normal', interrupt: false },
  extend: { priority: 'low', interrupt: false },
  hold: { priority: 'low', interrupt: false },
  return: { priority: 'low', interrupt: false },
  good: { priority: 'normal', interrupt: false },
  paused: { priority: 'high', interrupt: true },
  completed: { priority: 'high', interrupt: true },
};

/**
 * Spoken wording — and, just as importantly, what is NOT here.
 *
 * VOICE IS FOR FORM CORRECTION, NOT MOVEMENT NARRATION.
 *
 * A cue only reaches the speaker if it has an entry in this table. The correct
 * movement phases (`ready`, `extend`, `hold`, `return`) deliberately have none,
 * so a correct rep is completely silent: the large on-screen HUD is what carries
 * continuous instruction, and narrating "Extend." / "Hold." / "Return slowly."
 * over a user who is already doing the movement correctly is noise at best and
 * a spoken contradiction at worst — the detector reports the phase it has
 * *reached*, so a user who is already lowering their leg gets told to extend
 * while they are doing it.
 *
 * What remains is only what the engine genuinely knows is wrong (the three
 * positioning problems), plus the praise for a real rep (emitted from the rep
 * completion event, not from this table) and the Start / Pause / Resume /
 * Completed transitions (emitted by the explicit announce* methods).
 *
 * No wording is invented here beyond what the pipeline can support. There is no
 * "keep your back straight", because nothing in the engine measures a back.
 */
const SPEECH: Partial<Record<FeedbackKind, string>> = {
  setup: 'Sit sideways to the camera.',
  position: 'Move into the camera view.',
  positioning: 'Move into position.',
  stabilizing: 'Hold still.',
};

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/**
 * Counts up to twenty are spoken as words ("Rep four."), which is markedly
 * easier to follow mid-exercise than a digit. Beyond that the number is handed
 * to the engine as digits, which it reads correctly on its own.
 */
export function repCountToWords(count: number): string {
  if (!Number.isFinite(count) || count < 0) return String(count);
  const rounded = Math.floor(count);
  return rounded < ONES.length ? ONES[rounded] : String(rounded);
}

/** What the engine hands the controller for one processed pose frame. */
export type VoiceFrameInput = {
  feedback: FeedbackCue;
  repCompletedThisFrame: boolean;
  reps: number;
};

export class VoiceFeedbackController {
  /**
   * The last cue kind observed, tracked for EVERY frame including the silent
   * ones. This is the entire memory the policy needs: the decision is a pure
   * function of the previous kind and the current one, so there are no timers,
   * no cooldown bookkeeping and no clock to drift.
   */
  private lastKind: FeedbackKind | null = null;
  /** Set by pause(); silences all exercise cues until resume(). */
  private suspended = false;
  /** Set by complete()/halt(); silences everything, permanently. */
  private finished = false;
  private disposed = false;

  constructor(private readonly sink: SpeechSink) {}

  /**
   * The pose-frame entry point. Synchronous and non-blocking by design.
   *
   * A rep completion is handled here and NOT delegated to `consider`, because the
   * praise cue is latched on screen for many frames after the rep; routing it
   * through the normal path is what would repeat the announcement. It also
   * records `good` as the current kind, which is what releases the setup family
   * — a counted rep is proof the user is in a good posture.
   */
  onFrame({ feedback, repCompletedThisFrame, reps }: VoiceFrameInput): void {
    if (this.disposed || this.finished) return;
    // Part 8: nothing about the exercise is spoken while paused, and no rep can
    // be announced — the screen also stops feeding frames, so this is belt and
    // braces rather than the primary guard.
    if (this.suspended) return;

    if (repCompletedThisFrame) {
      const policy = POLICY.good;
      this.lastKind = 'good';
      this.emit(`Good. Rep ${repCountToWords(reps)}.`, policy);
      return;
    }

    this.consider(feedback.kind);
  }

  /**
   * Decides whether a cue kind should be spoken now.
   *
   * The policy is a STATE-TRANSITION rule, not a timer:
   *
   *   - a normal cue speaks only when the kind changes, so a state that persists
   *     is announced once and then left alone;
   *   - a SETUP cue speaks once on ENTRY to the setup family and is then silent
   *     for as long as any setup problem persists — however many frames, and
   *     however long, that takes. This is what stops "Move into position."
   *     repeating every few seconds while the user is still getting set up;
   *   - the family resets on any normal state (ready, a movement phase, a counted
   *     rep, a pause), so a problem that returns after a genuine recovery is
   *     announced again — once.
   *
   * The decision uses only the FeedbackKind the session engine already
   * published. No landmark, timing or confidence value is inspected here, so
   * there is no new pose heuristic and no way for a noisy frame to invent a
   * problem: the engine's own readiness state is the single source of truth.
   *
   * Exposed for the phase transitions, which are real state changes rather than
   * per-frame decisions, and for tests.
   */
  consider(kind: FeedbackKind, overrideText?: string): boolean {
    if (this.disposed || this.finished) return false;

    // The observed kind is recorded for EVERY cue, including the silent ones.
    // This is load-bearing: most movement kinds have no wording, so they return
    // early below. Without recording them, `lastKind` would stay pinned to the
    // last problem and the next genuine problem would be mistaken for a repeat
    // of the old one — the user would then never hear a correction again.
    const previousKind = this.lastKind;
    this.lastKind = kind;

    const policy = POLICY[kind];
    const text = overrideText ?? SPEECH[kind];
    if (!text) return false;

    // An explicit transition (Start / Pause / Resume) is a deliberate one-off
    // announcement from the screen, not a per-frame observation, so it is never
    // subject to the repeat rules below.
    if (overrideText === undefined) {
      // Still inside the same unresolved problem -> stay quiet.
      if (isSetupKind(kind) && isSetupKind(previousKind)) return false;
      // Any other kind: speak only on a genuine change of state.
      if (!isSetupKind(kind) && previousKind === kind) return false;
    }

    this.emit(text, policy);
    return true;
  }

  /** READY -> RUNNING. */
  announceStart(): void {
    if (this.disposed || this.finished) return;
    this.lastKind = null;
    this.consider('ready', 'Start.');
  }

  /** RUNNING -> PAUSED. Silences the exercise until resumed. */
  announcePause(): void {
    if (this.disposed || this.finished) return;
    this.suspended = true;
    this.lastKind = null;
    this.consider('paused', 'Paused.');
  }

  /** PAUSED -> RUNNING. */
  announceResume(): void {
    if (this.disposed || this.finished) return;
    this.suspended = false;
    this.lastKind = null;
    this.consider('ready', 'Resume.');
  }

  /**
   * RUNNING -> COMPLETED. Terminal: the session is over, so nothing further is
   * ever spoken for this controller's lifetime.
   */
  announceCompletion(reps: number): void {
    if (this.disposed || this.finished) return;
    this.finished = true;
    this.suspended = true;
    this.lastKind = 'completed';
    this.emit('Session complete.', POLICY.completed);
    if (reps > 0) this.emit(`You completed ${repCountToWords(reps)} reps.`, COMPLETION_TALLY_POLICY);
  }

  /** Pre-Start setup instruction, spoken once when the screen appears. */
  announceSetup(): void {
    this.consider('setup');
  }

  /**
   * Cancels anything in flight and forgets the observed state, so a new session
   * starts from a clean slate and will announce its own setup problems.
   */
  reset(): void {
    this.lastKind = null;
    this.suspended = false;
    this.finished = false;
    this.safeStop();
  }

  /**
   * Unmount cleanup. After this the controller is inert, so a late native
   * callback can neither speak nor touch React state.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.safeStop();
  }

  /**
   * Both native calls are wrapped: a device with no TTS engine, a revoked audio
   * permission, or a throwing mock must not take down the session. Rep counting
   * and the HUD are entirely independent of this path.
   */
  private emit(text: string, policy: KindPolicy): void {
    if (policy.interrupt) this.safeStop();
    try {
      this.sink.speak(text, { priority: policy.priority, interrupt: policy.interrupt });
    } catch {
      // Intentionally swallowed — see the doc comment above.
    }
  }

  private safeStop(): void {
    try {
      this.sink.stop();
    } catch {
      // Intentionally swallowed.
    }
  }
}

/**
 * The rep tally that follows "Session complete." It is identical to the
 * completion policy EXCEPT that it does not interrupt: the first utterance
 * interrupts whatever was in flight (correct — a finished session should cut
 * off stale coaching), but the tally must not cut off the sentence before it.
 * expo-speech queues utterances, so the pair plays back in order.
 */
const COMPLETION_TALLY_POLICY: KindPolicy = { ...POLICY.completed, interrupt: false };

/**
 * expo-speech is imported lazily and defensively. The module is only touched on
 * the first utterance so that a missing native module degrades to a silent
 * session instead of a crash at import time, and so the decision layer above can
 * be unit-tested on a machine with no native runtime at all.
 */
type SpeechModule = {
  speak(text: string, options?: Record<string, unknown>): void;
  stop(): Promise<void> | void;
};

let speechModule: SpeechModule | null | undefined;

function loadSpeech(): SpeechModule | null {
  if (speechModule !== undefined) return speechModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    speechModule = require('expo-speech') as SpeechModule;
  } catch {
    speechModule = null;
  }
  return speechModule;
}

/** The real sink. Every native error is absorbed rather than surfaced. */
export function createExpoSpeechSink(): SpeechSink {
  return {
    speak(text, { priority, interrupt }) {
      const speech = loadSpeech();
      if (!speech) return;
      try {
        speech.speak(text, {
          language: 'en-US',
          // Warnings lean slightly faster so they cut through and are noticed;
          // praise is a touch slower to read as encouragement.
          rate: priority === 'high' ? 1.05 : 0.95,
          pitch: 1,
          // expo-speech reports per-utterance failures through these callbacks.
          // There is nothing useful to do with them, and an unhandled one would
          // surface as a red box, so they are absorbed here.
          onError: () => {},
        });
      } catch {
        // Intentionally swallowed.
      }
      void interrupt;
    },
    stop() {
      const speech = loadSpeech();
      if (!speech) return;
      try {
        const result = speech.stop();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch(() => {});
        }
      } catch {
        // Intentionally swallowed.
      }
    },
  };
}
