import type { RepFrame, RepOutcome, RepPhase, RepThresholds } from './types';

/**
 * State-machine rep counter. A rep is counted only when a full cycle is
 * observed: rest → extending → extended (held) → returning → rest. State
 * transitions are confirmed over consecutive qualifying frames (`holdFrames`)
 * so a single noisy frame cannot flip the machine. Completed cycles shorter
 * than `minRangeDeg` or faster than `minRepIntervalMs` are discarded, which
 * rejects jitter and double counts. Instantiate one detector per tracked side.
 *
 * A cycle is only accepted if it was observed FROM ITS STARTING POSTURE: the
 * knee must actually be seen at or below `bentAngleDeg` before the machine will
 * act on anything. See `armed` below for why that precondition is load-bearing.
 */
export class RepDetector {
  private phase: RepPhase = 'rest';
  /**
   * False until the knee has genuinely been seen bent (angle <= bentAngleDeg).
   * While false, frames are observed but cannot move the machine.
   *
   * WHY THIS EXISTS — the "sitting down counts as a rep" bug
   * ---------------------------------------------------------
   * The bands are absolute (bent 140deg, extended 160deg), so a leg that is
   * ALREADY straight walks the machine all the way to `extended` on its own:
   * `rest` promotes to `extending` at >=140 and `extending` commits to
   * `extended` at >=160, with no requirement that the angle ever increased. A
   * motionless leg held at 176deg therefore "completes" an extension that never
   * happened, and the machine is left parked in `extended`.
   *
   * From there, simply LOWERING that leg completes a rep: `extended` drops to
   * `returning`, and two frames at or below 140deg call `completeRep`. Sitting
   * down is exactly that motion — the knee sweeps ~176deg to ~90deg — so
   * pressing Start while standing and then sitting down counted a rep. The
   * measured range was 53.7deg, comfortably over `minRangeDeg`, so the range
   * guard could not reject it either.
   *
   * Requiring an observed bent frame first makes the machine match the contract
   * it already documents ("rest → extending → extended → returning → rest"): a
   * cycle must be witnessed end-to-end, and the descending half of somebody
   * sitting down is the arming, not a rep. This is a precondition, not a
   * threshold change — every threshold keeps its value.
   */
  private armed = false;
  private extendedHold = 0;
  private returningHold = 0;
  private restHold = 0;
  private cycleMin: number | null = null;
  private cycleMax: number | null = null;
  private lastRepAtMs = 0;
  private lastFrameAtMs: number | null = null;
  private reps = 0;
  private repRanges: number[] = [];

  constructor(private readonly config: RepThresholds) {}

  get currentPhase(): RepPhase {
    return this.phase;
  }

  /** True once a bent starting posture has been observed this cycle. */
  get isArmed(): boolean {
    return this.armed;
  }

  // TEMPORARY DIAGNOSTIC ACCESSORS — remove with src/exercise/pose-diagnostics.ts
  // after the physical-device retest. Read-only; the pipeline does not use these.
  /** Lowest / highest angle seen since the current cycle began. */
  get cycleBounds(): { min: number | null; max: number | null } {
    return { min: this.cycleMin, max: this.cycleMax };
  }

  get completedReps(): number {
    return this.reps;
  }

  /** Ranges (deg) of every completed rep, in completion order. */
  get completedRanges(): number[] {
    return this.repRanges;
  }

  reset(): void {
    this.phase = 'rest';
    this.armed = false;
    this.extendedHold = 0;
    this.returningHold = 0;
    this.restHold = 0;
    this.cycleMin = null;
    this.cycleMax = null;
    this.lastRepAtMs = 0;
    this.lastFrameAtMs = null;
    this.reps = 0;
    this.repRanges = [];
  }

  /**
   * Suspends the machine without losing already-counted reps: any in-progress
   * cycle (holds, observed range, cooldown) is discarded but completed reps and
   * their ranges are preserved. Used when tracking is not ready (person left
   * the view, or is still stabilizing) so a partial cycle can never complete.
   *
   * It also disarms the machine. Tracking context was lost, so the next rep has
   * to re-establish its bent starting posture — which is precisely what stops a
   * relocation (sitting down, standing up, walking up) from being read as the
   * tail of a rep.
   */
  freeze(): void {
    this.phase = 'rest';
    this.armed = false;
    this.extendedHold = 0;
    this.returningHold = 0;
    this.restHold = 0;
    this.cycleMin = null;
    this.cycleMax = null;
    this.lastRepAtMs = 0;
    this.lastFrameAtMs = null;
  }

  /**
   * Feeds one joint-angle frame into the machine. Returns whether this frame
   * completed a rep and the resulting machine phase.
   */
  process(frame: RepFrame): RepOutcome {
    const { angle, timestampMs } = frame;
    if (!Number.isFinite(angle)) {
      return { repCompleted: false, repRange: null, phase: this.phase };
    }

    // A tracking stall is not movement. If the frames either side of a long gap
    // were joined, a knee extended before the stall and lowered after it would
    // be credited as one rep even though the lowering was never observed to
    // follow the extension. Discard the partial cycle and re-enter from rest, so
    // a rep must be witnessed end-to-end within continuous tracking. This is the
    // same guarantee freeze() gives on a presence loss, applied to a stall that
    // never reported a loss. Already-counted reps are untouched.
    if (
      this.lastFrameAtMs !== null &&
      timestampMs - this.lastFrameAtMs > this.config.maxFrameGapMs
    ) {
      this.resetCycle();
      this.phase = 'rest';
    }
    this.lastFrameAtMs = timestampMs;

    const { bentAngleDeg, extendedAngleDeg, holdFrames } = this.config;

    // Nothing counts until the bent starting posture has actually been seen.
    // Frames above the bent band are observed but cannot move the machine, and
    // they are deliberately NOT folded into cycleMin/cycleMax either — otherwise
    // a later completion would inherit the travel of a pre-rep posture and
    // clear `minRangeDeg` on movement the user never performed as a rep.
    if (!this.armed) {
      if (angle > bentAngleDeg) {
        return { repCompleted: false, repRange: null, phase: this.phase };
      }
      this.armed = true;
    }

    this.cycleMin = this.cycleMin === null ? angle : Math.min(this.cycleMin, angle);
    this.cycleMax = this.cycleMax === null ? angle : Math.max(this.cycleMax, angle);

    switch (this.phase) {
      case 'rest':
        this.extendedHold = 0;
        this.returningHold = 0;
        this.restHold = 0;
        if (angle >= bentAngleDeg) {
          this.phase = 'extending';
        }
        break;

      case 'extending':
        if (angle >= extendedAngleDeg) {
          this.extendedHold += 1;
          if (this.extendedHold >= holdFrames) {
            this.phase = 'extended';
            this.extendedHold = 0;
          }
        } else if (angle <= bentAngleDeg) {
          // Fell back to rest without ever reaching extension: false start.
          this.phase = 'rest';
          this.resetCycle();
        } else {
          this.extendedHold = 0;
        }
        break;

      case 'extended':
        if (angle >= extendedAngleDeg - 1) {
          this.returningHold = 0;
          break;
        }
        this.returningHold += 1;
        if (this.returningHold >= holdFrames) {
          this.phase = 'returning';
          this.returningHold = 0;
        }
        break;

      case 'returning':
        if (angle >= extendedAngleDeg) {
          // Bounced back up before reaching rest: treat as still extended.
          this.restHold = 0;
          this.phase = 'extended';
          break;
        }
        if (angle <= bentAngleDeg) {
          this.restHold += 1;
          if (this.restHold >= holdFrames) {
            return this.completeRep(timestampMs);
          }
        } else {
          this.restHold = 0;
        }
        break;
    }

    return { repCompleted: false, repRange: null, phase: this.phase };
  }

  private completeRep(timestampMs: number): RepOutcome {
    const { minRangeDeg, minRepIntervalMs } = this.config;

    const min = this.cycleMin ?? Number.NaN;
    const max = this.cycleMax ?? Number.NaN;
    const range = max - min;

    const cooldownElapsed = timestampMs - this.lastRepAtMs >= minRepIntervalMs;
    const qualifies = Number.isFinite(range) && range >= minRangeDeg && cooldownElapsed;

    this.resetCycle();
    this.phase = 'rest';

    if (!qualifies) {
      return { repCompleted: false, repRange: null, phase: this.phase };
    }

    this.reps += 1;
    this.repRanges.push(range);
    this.lastRepAtMs = timestampMs;
    return { repCompleted: true, repRange: range, phase: this.phase };
  }

  private resetCycle(): void {
    this.cycleMin = null;
    this.cycleMax = null;
    this.extendedHold = 0;
    this.returningHold = 0;
    this.restHold = 0;
  }
}