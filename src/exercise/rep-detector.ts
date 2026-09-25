import type { RepFrame, RepOutcome, RepPhase, RepThresholds } from './types';

/**
 * State-machine rep counter. A rep is counted only when a full cycle is
 * observed: rest → extending → extended (held) → returning → rest. State
 * transitions are confirmed over consecutive qualifying frames (`holdFrames`)
 * so a single noisy frame cannot flip the machine. Completed cycles shorter
 * than `minRangeDeg` or faster than `minRepIntervalMs` are discarded, which
 * rejects jitter and double counts. Instantiate one detector per tracked side.
 */
export class RepDetector {
  private phase: RepPhase = 'rest';
  private extendedHold = 0;
  private returningHold = 0;
  private restHold = 0;
  private cycleMin: number | null = null;
  private cycleMax: number | null = null;
  private lastRepAtMs = 0;
  private reps = 0;
  private repRanges: number[] = [];

  constructor(private readonly config: RepThresholds) {}

  get currentPhase(): RepPhase {
    return this.phase;
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
    this.extendedHold = 0;
    this.returningHold = 0;
    this.restHold = 0;
    this.cycleMin = null;
    this.cycleMax = null;
    this.lastRepAtMs = 0;
    this.reps = 0;
    this.repRanges = [];
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

    const { bentAngleDeg, extendedAngleDeg, holdFrames } = this.config;

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