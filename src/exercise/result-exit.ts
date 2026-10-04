/**
 * LEAVING A FINISHED EXERCISE
 * ============================
 *
 * The result screen is PUSHED on top of the session that produced it
 * (`exercise/session.tsx` pushes `/exercise/result`), so the stack underneath the
 * "Done" button is:
 *
 *   (tabs) > exercise > exercise/[id] > exercise/session > exercise/result
 *
 * `router.replace('/')` swaps only the TOP entry for Home and leaves everything
 * below it untouched, so the finished session stayed in the stack underneath
 * Home. One Back press from the home screen reopened a session that had already
 * been completed and saved, showing its terminal state.
 *
 * POP_TO_TOP is the operation that matches the intent, because the root route is
 * the `(tabs)` group: it removes the result and the session together, and leaves
 * the person on the four destinations the app always returns to. `navigate('/')`
 * then puts the Home tab in front, because the flow may have been started from
 * another tab and "Done" means Home rather than "wherever you came from".
 *
 * Deliberately NOT applied to the other three exits in the app:
 *
 * - `activity-result.tsx` is reached by `router.replace`, so its session screen
 *   is already gone and replacing the result with Home leaves only the routine
 *   list beneath it. That is a list, not a finished session, and going Back to
 *   it is the behaviour a person expects.
 * - `exercise/session.tsx` calls this only from the completed session screen
 *   itself, so the entry it replaces IS the session.
 * - The session screen's own "Back" replaces the session with the exercise list,
 *   which is the screen that started it.
 *
 * None of the above is assumed: `tests/result-navigation.test.ts` drives the real
 * `StackRouter` reducer from the pinned expo-router against this exact stack, and
 * asserts both that `replace` leaves the session behind and that this exit does
 * not. It cannot mount Expo Router itself, so the reducer is exercised directly.
 *
 * What that suite does NOT cover is this module still being wired up: it calls
 * `leaveExerciseResult` with a stand-in router, so reverting the screen's own
 * `leave` to `router.replace('/')` would leave the suite green. The reducer
 * argument above is what makes the exit's behaviour trustworthy; the single call
 * site in `src/app/exercise/result.tsx` is still only covered by the compiler and
 * by hand on a device.
 */

/**
 * The two operations this needs, and nothing else. Declared with method syntax on
 * purpose: method parameters are bivariant, so the real `ImperativeRouter`
 * satisfies this even though `Href` is a narrow literal union under typed routes.
 */
export type ResultExitRouter = {
  dismissAll(): void;
  navigate(href: '/'): void;
};

/**
 * Ends the whole exercise flow and returns to Home with no finished session left
 * anywhere beneath it.
 */
export function leaveExerciseResult(router: ResultExitRouter): void {
  router.dismissAll();
  router.navigate('/');
}