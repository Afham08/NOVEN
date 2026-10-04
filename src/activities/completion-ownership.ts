/**
 * WHO OWNS A COMPLETION
 * =====================
 *
 * Recording a finished session is asynchronous, and the person can start another
 * one while that write is still in flight. "Start again" is offered on the
 * finished screen, and that screen is rendered the moment the session reaches its
 * terminal phase - which is BEFORE the save resolves. So the two really are
 * concurrent, and a save in flight belongs to a session that may already have
 * been replaced.
 *
 * A once-only boolean cannot express this, and the reason matters: `startFresh`
 * deliberately CLEARS that flag, because the new session is entitled to save too.
 * Clearing it is exactly what re-opens the door that a stale completion then
 * walks back through, navigating the new session to the old session's result.
 *
 * What is needed is ownership rather than a boolean: a claim that identifies one
 * completion attempt, and a way to ask "is that still the attempt that owns this
 * screen?" after every await. `CompletionOwnership` is that and nothing more - no
 * session, no record, no timers - which is what keeps it testable on its own.
 */

/**
 * A claim on the completion of one session. A number rather than an object so a
 * stale claim can never be mistaken for a current one by identity comparison.
 */
export type CompletionToken = number;

export class CompletionOwnership {
  private generation = 0;

  /**
   * Claims ownership and returns the token that proves it. Two claims can never
   * both be current, so a second completion attempt - a double tap, a re-render,
   * the auto-save racing a press - loses instead of navigating twice.
   */
  claim(): CompletionToken {
    this.generation += 1;
    return this.generation;
  }

  /** True only while `token` is the newest claim. */
  owns(token: CompletionToken): boolean {
    return token === this.generation;
  }

  /**
   * Gives up the current claim without making a new one.
   *
   * Called when the screen starts another session and when it unmounts. In both
   * cases work already in flight belongs to a lifecycle that is over, so it must
   * not navigate afterwards - on unmount there is no screen left to navigate, and
   * the router outlives the component.
   */
  release(): void {
    this.generation += 1;
  }
}

/**
 * What happened to a completion once its save settled.
 *
 * - `navigated`: the attempt still owned the screen, so its result was shown.
 * - `abandoned`: ownership had already moved on, so nothing was navigated and the
 *   screen that exists now belongs to someone else.
 */
export type CompletionOutcome = 'navigated' | 'abandoned';

export type FinishOwnedSessionOptions = {
  ownership: CompletionOwnership;
  token: CompletionToken;
  /**
   * The write itself. A rejection is a failed save, not a failed completion.
   *
   * `Promise<unknown>` because the resolved value is deliberately ignored: the
   * store hands back the record it wrote, and only whether the write settled
   * without throwing is any part of this decision's business.
   */
  save: () => Promise<unknown>;
  /** Called at most once, and only while `token` is still current. */
  navigate: (saved: boolean) => void;
};

/**
 * Awaits the save, then navigates only if this completion still owns the screen.
 *
 * The save is awaited unconditionally: a session that really happened must be
 * recorded even if the person has already started another one, and exactly-once
 * recording is the point of the write. Only the RESPONSE to it - navigating to a
 * result - is conditional, because that is the part that would corrupt a session
 * that has since begun.
 *
 * A rejected save is absorbed here and reported to the caller as `saved: false`,
 * which is the status the result screen already shows the person. It is not
 * swallowed silently: the screen words it out rather than claiming a write landed
 * when it did not.
 */
export async function finishOwnedSession(
  options: FinishOwnedSessionOptions,
): Promise<CompletionOutcome> {
  let saved = false;
  try {
    await options.save();
    saved = true;
  } catch {
    // The write did not land, so `saved` stays false. Not retried: a history that
    // could not be read is not something a second write could safely fix.
  }

  if (!options.ownership.owns(options.token)) return 'abandoned';

  options.navigate(saved);
  return 'navigated';
}