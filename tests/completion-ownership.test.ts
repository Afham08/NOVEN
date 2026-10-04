/**
 * COMPLETION OWNERSHIP
 * ===================
 *
 * Recording a finished session is async, and "Start again" is on screen while it
 * is in flight. Before the fix, the continuation after `await saveSession(...)`
 * navigated unconditionally, so a restart pressed in that window was dragged to
 * the PREVIOUS session's result. The screen's own `leavingRef` could not prevent
 * it, because `startFresh` deliberately clears that flag for the new session.
 *
 * Everything here is driven by deferred promises rather than timers, so the
 * interleaving is exact and deterministic: the test decides the precise moment
 * the save settles relative to the restart, and nothing depends on scheduling.
 */

import {
  CompletionOwnership,
  finishOwnedSession,
  type CompletionOutcome,
  type CompletionToken,
} from '../src/activities/completion-ownership';
import { check, suite } from './harness';

/** A promise whose settlement the test controls, with no timer involved. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The screen's completion, reduced to the part that can race: claim, save, then
 * navigate only if the claim still holds. `session` stands in for "which session
 * is on screen", so a hijack is observable as the wrong session owning the result.
 */
function createScreen() {
  const ownership = new CompletionOwnership();
  let activeSession = 'A';
  let saving = false;
  const navigations: { session: string; saved: boolean }[] = [];

  return {
    ownership,
    get activeSession() {
      return activeSession;
    },
    get saving() {
      return saving;
    },
    navigations,

    /** Mirrors `startFresh`: clear the once-only flag, revoke, then start. */
    startFresh(next: string) {
      ownership.release();
      saving = false;
      activeSession = next;
    },

    /** Mirrors `complete()`. `leavingRef` is modelled by the caller's guard. */
    async complete(session: string, save: () => Promise<void>): Promise<CompletionOutcome> {
      const token: CompletionToken = ownership.claim();
      saving = true;
      const outcome = await finishOwnedSession({
        ownership,
        token,
        save,
        navigate: (saved) => {
          navigations.push({ session: activeSession, saved });
        },
      });
      return outcome;
    },
  };
}

export function run(): void {
  suite('a completion that still owns the screen navigates', async () => {
    const screen = createScreen();
    const gate = deferred<void>();
    const pending = screen.complete('A', () => gate.promise);

    // The save is still in flight: nothing may have navigated yet.
    check('nothing navigates while the save is pending', screen.navigations.length === 0);
    check('the screen is marked saving while pending', screen.saving === true);

    gate.resolve();
    const outcome = await pending;

    check('the outcome is the navigating one', outcome === 'navigated', outcome);
    check('exactly one navigation happened', screen.navigations.length === 1, screen.navigations);
    check('it carried the save outcome', screen.navigations[0]?.saved === true, screen.navigations);
    check('the result belongs to session A', screen.navigations[0]?.session === 'A', screen.navigations);
  });

  suite('a stale completion cannot hijack a restarted session', async () => {
    const screen = createScreen();
    const gate = deferred<void>();

    // Session A finishes; its save is still in flight.
    const pendingA = screen.complete('A', () => gate.promise);

    // The person presses "Start again" while that save is pending.
    screen.startFresh('B');
    check('session B is the active session now', screen.activeSession === 'B');
    check('the restart cleared the saving state', screen.saving === false);

    // A's save now lands. It must not touch session B.
    gate.resolve();
    const outcomeA = await pendingA;

    check('the stale completion abandoned instead of navigating', outcomeA === 'abandoned', outcomeA);
    check('no navigation was performed at all', screen.navigations.length === 0, screen.navigations);
    check('session B is still the active session', screen.activeSession === 'B');

    // B is unaffected: it can still complete and record its own result.
    const gateB = deferred<void>();
    const pendingB = screen.complete('B', () => gateB.promise);
    gateB.resolve();
    const outcomeB = await pendingB;

    check('session B can still complete normally', outcomeB === 'navigated', outcomeB);
    check('only B ever navigated', screen.navigations.length === 1, screen.navigations);
    check('the result belongs to session B', screen.navigations[0]?.session === 'B', screen.navigations);
  });

  suite('a stale completion that failed to save still does not hijack', async () => {
    const screen = createScreen();
    const gate = deferred<void>();

    const pendingA = screen.complete('A', () => gate.promise);
    screen.startFresh('B');
    // A's write rejects after the restart: a failed save must not become a
    // navigation onto session B.
    gate.reject(new Error('history could not be read'));
    const outcome = await pendingA;

    check('the failed stale save abandoned', outcome === 'abandoned', outcome);
    check('no navigation carried a failed status', screen.navigations.length === 0, screen.navigations);
  });

  suite('repeated completion attempts cannot both own the screen', async () => {
    const ownership = new CompletionOwnership();
    const first = ownership.claim();
    const second = ownership.claim();

    check('only the newest claim owns the screen', ownership.owns(second));
    check('the first claim has lost ownership', !ownership.owns(first));
    check('the two claims are distinct', first !== second);
  });

  suite('releasing without claiming still revokes the current claim', async () => {
    const ownership = new CompletionOwnership();
    const token = ownership.claim();
    check('the claim owns the screen to begin with', ownership.owns(token));

    ownership.release();
    check('a release revokes it', !ownership.owns(token));

    // A later claim is still honoured, so a screen that keeps working is not
    // permanently locked out by one release.
    const next = ownership.claim();
    check('a fresh claim works after a release', ownership.owns(next));
  });

  suite('an unmount revokes a completion that is still saving', async () => {
    // The screen's unmount effect is `ownership.release()`; the router outlives
    // the component, so a save resolving afterwards must navigate nowhere.
    const ownership = new CompletionOwnership();
    const gate = deferred<void>();
    const navigations: boolean[] = [];

    const token = ownership.claim();
    const pending = finishOwnedSession({
      ownership,
      token,
      save: () => gate.promise,
      navigate: (saved) => navigations.push(saved),
    });

    ownership.release();
    gate.resolve();
    const outcome = await pending;

    check('a completion after unmount abandons', outcome === 'abandoned', outcome);
    check('nothing navigated after unmount', navigations.length === 0, navigations);
  });

  suite('a rejected save is reported rather than thrown', async () => {
    const ownership = new CompletionOwnership();
    const token = ownership.claim();
    let navigatedWith: boolean | null = null;

    const outcome = await finishOwnedSession({
      ownership,
      token,
      save: () => Promise.reject(new Error('storage unavailable')),
      navigate: (saved) => {
        navigatedWith = saved;
      },
    });

    // The screen still owns the screen, so it still shows a result - but with the
    // honest "not saved" status rather than claiming the write landed.
    check('a failed save still completes while owned', outcome === 'navigated', outcome);
    check('the failure is reported to the caller', navigatedWith === false, navigatedWith);
  });

  suite('a save that throws synchronously is also absorbed', async () => {
    const ownership = new CompletionOwnership();
    const token = ownership.claim();
    let navigatedWith: boolean | null = null;

    const outcome = await finishOwnedSession({
      ownership,
      token,
      save: () => {
        throw new Error('threw before returning a promise');
      },
      navigate: (saved) => {
        navigatedWith = saved;
      },
    });

    check('a synchronous throw is not fatal', outcome === 'navigated', outcome);
    check('and is reported as a failed save', navigatedWith === false, navigatedWith);
  });

  suite('the save runs even when the completion has already lost the screen', async () => {
    // Recording is unconditional: the session really happened, so it must be
    // written exactly once even when its result is no longer going to be shown.
    const ownership = new CompletionOwnership();
    const gate = deferred<void>();
    let saves = 0;

    const token = ownership.claim();
    const pending = finishOwnedSession({
      ownership,
      token,
      save: () => {
        saves += 1;
        return gate.promise;
      },
      navigate: () => {
        throw new Error('must not navigate');
      },
    });

    ownership.release();
    gate.resolve();
    await pending;

    check('the write still happened exactly once', saves === 1, saves);
  });
}