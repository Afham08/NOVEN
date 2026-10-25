import type { PoseTrackerErrorPayload } from '../../modules/pose-tracker';
import type { SessionEngine } from './session-engine';

export type PoseTrackerFailureCategory = PoseTrackerErrorPayload['category'];

export type PoseTrackerFailure = {
  category: PoseTrackerFailureCategory;
  /** App-owned copy; native exception details are never surfaced to the user. */
  message: string;
};

const SAFE_FAILURE_MESSAGES: Readonly<Record<PoseTrackerFailureCategory, string>> = {
  'camera-permission': 'Camera permission is unavailable. Allow camera access, then reopen the session.',
  'camera-startup': 'The camera could not start. Return to exercises and reopen the session.',
  'camera-runtime': 'The camera stopped unexpectedly. Return to exercises and reopen the session.',
  'pose-initialization': 'Pose tracking could not start. Return to exercises and reopen the session.',
  'pose-runtime': 'Pose tracking stopped unexpectedly. Return to exercises and reopen the session.',
};

/**
 * One native view belongs to one exercise-session screen. Accept only its first
 * fatal error; deactivation on unmount prevents late callbacks from an older
 * view from changing state after navigation. This deliberately has no retry
 * operation because the native view lifecycle does not support safe in-place
 * camera restart.
 */
export class PoseTrackerFailureGate {
  private active = true;
  private currentFailure: PoseTrackerFailure | null = null;

  get failure(): PoseTrackerFailure | null {
    return this.currentFailure;
  }

  activate(): void {
    if (this.currentFailure === null) this.active = true;
  }

  deactivate(): void {
    this.active = false;
  }

  receive(payload: PoseTrackerErrorPayload): PoseTrackerFailure | null {
    if (!this.active || this.currentFailure !== null) return null;

    const failure: PoseTrackerFailure = {
      category: payload.category,
      message: SAFE_FAILURE_MESSAGES[payload.category],
    };
    this.currentFailure = failure;
    return failure;
  }
}

/** Freeze the engine on the first fatal native event; preserve its final metrics. */
export function stopSessionOnPoseTrackerFailure(
  gate: PoseTrackerFailureGate,
  payload: PoseTrackerErrorPayload,
  engine: SessionEngine | null,
): PoseTrackerFailure | null {
  const failure = gate.receive(payload);
  if (failure !== null) engine?.end();
  return failure;
}
