export type SessionHistorySaveStatus = 'saving' | 'saved' | 'failed';

type StatusListener = (status: SessionHistorySaveStatus) => void;

const MAX_RETAINED_STATUSES = 50;

/** Tracks best-effort exercise-history writes without delaying result navigation. */
export class SessionSaveStatusTracker {
  private readonly statuses = new Map<string, SessionHistorySaveStatus>();
  private readonly listeners = new Map<string, Set<StatusListener>>();

  /** Start the write immediately and resolve with a status instead of rejecting. */
  track<T>(recordId: string, save: () => Promise<T>): Promise<void> {
    this.publish(recordId, 'saving');

    let pending: Promise<T>;
    try {
      pending = save();
    } catch {
      this.publish(recordId, 'failed');
      return Promise.resolve();
    }

    return pending.then(
      () => this.publish(recordId, 'saved'),
      () => this.publish(recordId, 'failed'),
    );
  }

  /** Subscribe to a record's current status and any later change. */
  subscribe(recordId: string, listener: StatusListener): () => void {
    let recordListeners = this.listeners.get(recordId);
    if (!recordListeners) {
      recordListeners = new Set<StatusListener>();
      this.listeners.set(recordId, recordListeners);
    }
    recordListeners.add(listener);

    const current = this.statuses.get(recordId);
    if (current) listener(current);

    return () => {
      recordListeners?.delete(listener);
      if (recordListeners?.size === 0) this.listeners.delete(recordId);
    };
  }

  private publish(recordId: string, status: SessionHistorySaveStatus): void {
    this.statuses.set(recordId, status);
    this.trimOldStatuses(recordId);
    this.listeners.get(recordId)?.forEach((listener) => listener(status));
  }

  private trimOldStatuses(currentRecordId: string): void {
    if (this.statuses.size <= MAX_RETAINED_STATUSES) return;

    for (const recordId of this.statuses.keys()) {
      if (recordId === currentRecordId || this.listeners.has(recordId)) continue;
      this.statuses.delete(recordId);
      if (this.statuses.size <= MAX_RETAINED_STATUSES) return;
    }
  }
}

export const sessionSaveStatusTracker = new SessionSaveStatusTracker();
