/**
 * RESULT EXIT NAVIGATION
 * =====================
 *
 * The exercise result screen is pushed on top of the session screen, so "Done"
 * has to remove BOTH. `router.replace('/')` removed only the top one and left the
 * completed session in the stack, where a Back press from Home reopened it.
 *
 * This suite runs the REAL `StackRouter` reducer from the pinned expo-router
 * rather than asserting on the text of the call. That matters because the whole
 * question is what a reducer does to a stack, and only the reducer knows: the
 * same `replace` is harmless in the guided flow - whose session screen is already
 * replaced - and a bug in the exercise flow. A `code.includes('dismissAll')` check
 * could not tell those two apart, and would go on passing if someone swapped the
 * call for something else that happened to contain the word.
 *
 * Expo Router cannot be mounted here - its state builder pulls in React Native,
 * and this repo's tests are plain Node with no renderer. So the route stack is
 * hand-built to match `src/app/_layout.tsx`, and the reducer is real. What stays
 * unverified, and is reported as such, is that the screen hands its live router
 * to `leaveExerciseResult` and what a physical Back press looks like.
 */

import { StackActions, StackRouter } from 'expo-router/build/react-navigation/routers/StackRouter';
import { leaveExerciseResult } from '../src/exercise/result-exit';
import { check, suite } from './harness';

/** The app's root Stack holds `(tabs)` as its initial route. */
const HOME = '(tabs)';

/** React Navigation's own state and action types, taken from the reducer itself. */
type StackState = Parameters<ReturnType<typeof StackRouter>['getStateForAction']>[0];
type StackAction = Parameters<ReturnType<typeof StackRouter>['getStateForAction']>[1];

/** The stack as it really is when the exercise result is on screen. */
const EXERCISE_FLOW = [HOME, 'exercise/index', 'exercise/[id]', 'exercise/session', 'exercise/result'];

/**
 * The guided flow, for contrast: the guided screen reaches its result with
 * `router.replace`, so no session screen sits underneath to leak. This is the
 * case that must NOT be "fixed" by the same change.
 */
const GUIDED_FLOW = [HOME, 'yoga', 'activity-result'];

/*
 * A minimal but faithful instance of the reducer's state. The cast is one cast
 * rather than a pile of assertions because the real type is React Navigation's,
 * carrying nested params this suite has no use for; every field the reducer
 * actually reads - `index`, `key`, `routeNames`, `routes`, `preloadedRoutes` -
 * is supplied truthfully here.
 */
function stackOf(routeNames: string[]): StackState {
  return {
    type: 'stack',
    key: 'root',
    index: routeNames.length - 1,
    routeNames,
    routes: routeNames.map((name, i) => ({ key: `r${i}`, name })),
    preloadedRoutes: [],
    stale: false,
    history: [],
  } as StackState;
}

/**
 * A router that drives the real reducer, so a suite can assert on the resulting
 * stack instead of on which method was called.
 *
 * `navigate('/')` deliberately does NOT touch the stack. In this app `/` resolves
 * into the `(tabs)` group, which is ONE root-stack entry holding four tabs, so
 * navigating to it selects the Home tab and leaves the stack above `(tabs)`
 * exactly as it was. That is the whole reason the exit has to pop: focusing Home
 * was never going to remove the session by itself.
 */
function recordingRouter() {
  const router = StackRouter({});
  const options = {
    routeNames: [...EXERCISE_FLOW, ...GUIDED_FLOW],
    routeParamList: {},
    routeGetIdList: {},
  };
  const calls: string[] = [];
  let state = stackOf(EXERCISE_FLOW);
  let activeTab = 'activities';

  /*
   * The reducer returns either a full state or a partial one, and only the full
   * one describes a stack. Normalising in one place keeps every action below
   * reading as the single call it is.
   */
  const apply = (action: StackAction): void => {
    const next = router.getStateForAction(state, action, options);
    if (next !== null && 'routes' in next) state = next as StackState;
  };

  return {
    calls,
    activeTab: () => activeTab,
    stack: (): string[] => state.routes.map((route) => route.name),
    seed(flow: string[]) {
      state = stackOf(flow);
    },
    dismissAll() {
      calls.push('dismissAll');
      apply(StackActions.popToTop());
    },
    navigate(href: '/') {
      calls.push(`navigate:${href}`);
      // Selects the Home tab. The root stack is untouched, as it is in the app.
      activeTab = 'index';
    },
    /** The pre-fix behaviour, kept so the suite can prove it is detectable. */
    legacyReplace() {
      calls.push('replace');
      apply(StackActions.replace(HOME));
    },
  };
}

export function run(): void {
  suite('result exit removes the completed session', () => {
    // The control: with the old call, the session survives underneath Home. If
    // this ever stops being true, the suite has stopped being able to see the bug.
    const legacy = recordingRouter();
    legacy.legacyReplace();
    check(
      'CONTROL: replace("/") alone leaves the completed session in the stack',
      legacy.stack().includes('exercise/session'),
      legacy.stack(),
    );

    // The second control: focusing Home without popping is what the screen did
    // before, and it is not enough on its own either. This is what proves the
    // pop in the fix is load-bearing rather than decorative.
    const focusOnly = recordingRouter();
    focusOnly.navigate('/');
    check(
      'CONTROL: focusing Home without popping also leaves the session',
      focusOnly.stack().includes('exercise/session'),
      focusOnly.stack(),
    );

    const fixed = recordingRouter();
    leaveExerciseResult(fixed);
    const after = fixed.stack();

    check('no finished session is left in the stack', !after.includes('exercise/session'), after);
    check('the result screen is gone too', !after.includes('exercise/result'), after);
    check('the whole exercise flow is gone', !after.some((name) => name.startsWith('exercise/')), after);
    check('Home is the only route left', after.length === 1 && after[0] === HOME, after);
    check('a Back press from Home has no session to reveal', after.length === 1, after);
  });

  suite('result exit returns to the tabs root whatever tab it started from', () => {
    const router = recordingRouter();
    leaveExerciseResult(router);
    check('it lands on the tabs root', router.stack()[0] === HOME, router.stack());
    check('and nothing is left above it', router.stack().length === 1, router.stack());

    // A deep link straight into the result screen: the stack is short, and the
    // exit must still not leave a result screen behind for Back to reveal.
    const deepLinked = recordingRouter();
    deepLinked.seed([HOME, 'exercise/result']);
    leaveExerciseResult(deepLinked);
    check(
      'a deep-linked result still pops to the root',
      deepLinked.stack().length === 1 && deepLinked.stack()[0] === HOME,
      deepLinked.stack(),
    );
  });

  suite('result exit pops the stack rather than replacing the top route', () => {
    const router = recordingRouter();
    leaveExerciseResult(router);
    check('the stack is popped first', router.calls[0] === 'dismissAll', router.calls);
    check('Home is focused afterwards', router.calls.includes('navigate:/'), router.calls);
    check('no route is replaced in place', !router.calls.includes('replace'), router.calls);
  });

  suite('the guided result flow is deliberately left on replace', () => {
    // The contrast that justifies not touching `activity-result.tsx`: on the
    // guided stack there is no session screen to leak, so popping instead would
    // throw away the routine list the person came from.
    const guided = recordingRouter();
    guided.seed(GUIDED_FLOW);
    guided.legacyReplace();
    const after = guided.stack();

    check(
      'CONTROL: nothing from the guided session is left underneath',
      !after.some((name) => name.endsWith('/[id]')),
      after,
    );
    check(
      'Back from Home lands on the routine list, not a finished session',
      after[after.length - 2] === 'yoga',
      after,
    );
  });
}