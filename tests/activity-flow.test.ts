import { check, suite } from './harness';

import { guidedCatalog } from '../src/activities/catalog';
import { guidedActivitiesForDay } from '../src/activities/catalog';
import { describeSessionOutcome } from '../src/activities/activity-format';
import { totalStepSeconds } from '../src/activities/types';
import { exercisesCatalog, getExerciseById } from '../src/data/exercises';
import { getExerciseConfig, isPoseTracked, poseTrackedConfigs } from '../src/exercise/pose-configs';
import { buildProgress, type ProgressInput } from '../src/exercise/progress';
import { createSessionRecord, parseSessionRecord } from '../src/exercise/session-store';
import { buildSessionMetrics } from '../src/exercise/metrics';
import type { SessionMetrics } from '../src/exercise/types';

/*
 * These suites read the app's source rather than importing the screens, for the
 * same reason settings-navigation.test.ts does: the screens are React Native
 * components with @/ aliases and native-only imports, and the test build
 * deliberately excludes them. What is guarded here is the shape of the flow —
 * that every activity has a route, that the route is registered, and that the
 * screens do not claim measurements they do not have.
 */
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
  resolve(...segments: string[]): string;
};

const fs = require('fs') as ReturnType<typeof require>;
const nodePath = require('path') as ReturnType<typeof require>;

// __dirname is the COMPILED test directory, so the app source is two levels up.
const fromApp = (...segments: string[]) => nodePath.resolve(__dirname, '../../src/app', ...segments);
const fromComponents = (...segments: string[]) => nodePath.resolve(__dirname, '../../src/components', ...segments);
const fromSrc = (...segments: string[]) => nodePath.resolve(__dirname, '../../src', ...segments);
const read = (...segments: string[]) => fs.readFileSync(fromApp(...segments), 'utf8');
const readComponent = (...segments: string[]) => fs.readFileSync(fromComponents(...segments), 'utf8');
const exists = (...segments: string[]) => fs.existsSync(fromApp(...segments));

/** Removes comments, so wording a person would see is not confused with prose about it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

export function run(): void {
  // ==========================================================================
  // Task 1: the exercise catalogue is a real catalogue
  // ==========================================================================
  suite('exercise catalogue: every entry is a real, startable exercise', () => {
    check('there is more than one exercise', exercisesCatalog.length > 1, exercisesCatalog.length);

    for (const exercise of exercisesCatalog) {
      check(`${exercise.id} has a name`, exercise.name.trim().length > 0);
      check(`${exercise.id} has a category`, exercise.category.trim().length > 0);
      check(`${exercise.id} has a difficulty`, exercise.difficulty.trim().length > 0);
      check(`${exercise.id} has a target`, exercise.target.trim().length > 0);
      check(`${exercise.id} has a positive duration`, exercise.durationSeconds > 0, exercise.durationSeconds);
      check(`${exercise.id} has at least two instructions`, exercise.instructions.length >= 2, exercise.instructions.length);
      check(`${exercise.id} has a safety note`, exercise.safetyNote.trim().length > 0);
      check(`${exercise.id} is findable by its own id`, getExerciseById(exercise.id)?.id === exercise.id);
    }

    check('ids are unique', new Set(exercisesCatalog.map((e) => e.id)).size === exercisesCatalog.length);
  });

  suite('exercise catalogue: nothing is offered that the camera cannot do', () => {
    for (const exercise of exercisesCatalog) {
      check(`${exercise.id} has camera thresholds to be measured against`, isPoseTracked(exercise.id), exercise.id);
    }
    check('the registry has a config for every catalogue entry', exercisesCatalog.every((e) => getExerciseConfig(e.id) !== undefined));
    check('and the registry has nothing extra', poseTrackedConfigs.length === exercisesCatalog.length, `${poseTrackedConfigs.length} vs ${exercisesCatalog.length}`);
  });

  suite('exercise catalogue: the existing movement is untouched', () => {
    // The knee extension is the one that was actually verified on a device. The
    // two added movements reuse the same engine, but the original config is still
    // read from the original, protected file.
    const configs = fs.readFileSync(fromSrc('exercise', 'configs.ts'), 'utf8');
    check('the original config file is still the source of the knee extension', configs.includes('SEATED_KNEE_EXTENSION'));
    check('the original config was not moved into the new registry', !/SEATED_KNEE_EXTENSION\s*=/.test(fs.readFileSync(fromSrc('exercise', 'pose-configs.ts'), 'utf8')));
    check('the knee extension still resolves', getExerciseConfig('seated-knee-extension') !== undefined);
  });

  // ==========================================================================
  // Task 5: the whole flow exists, all the way down
  // ==========================================================================
  suite('activity flow: every activity has a route that reaches a start button', () => {
    const layout = read('_layout.tsx');

    for (const [kind, file] of [
      ['yoga', 'yoga.tsx'],
      ['meditation', 'meditation.tsx'],
      ['wellness', 'wellness.tsx'],
    ] as const) {
      for (const activity of guidedCatalog(kind)) {
        check(`${activity.id} has a detail route`, exists(kind, '[id].tsx'), `${kind}/[id].tsx`);
      }
      check(`${kind} keeps its own list route`, exists(file), file);
      check(`${kind} is registered in the stack`, layout.includes(`name="${kind}"`), kind);
      check(`${kind}/[id] is registered in the stack`, layout.includes(`name="${kind}/[id]"`), `${kind}/[id]`);
    }

    check('one shared result screen serves all three', exists('activity-result.tsx'));
    check('the result screen is registered', layout.includes('name="activity-result"'));
  });

  suite('activity flow: the detail screen is a route, not a duplicate screen', () => {
    for (const kind of ['yoga', 'meditation', 'wellness'] as const) {
      const route = read(kind, '[id].tsx');
      check(`${kind}/[id] carries no wording of its own`, !/summary|safetyNote/.test(stripComments(route)), route);
      check(`${kind}/[id] uses the one shared screen`, route.includes('GuidedActivityScreen'));
      check(`${kind}/[id] refuses an id from another kind`, route.includes(`findGuidedActivityInKind('${kind}'`), route);
    }
  });

  suite('activity flow: the list screens link to their detail routes', () => {
    for (const kind of ['yoga', 'meditation', 'wellness'] as const) {
      const list = read(`${kind}.tsx`);
      check(`${kind} links into its own detail route`, list.includes(`\`/${kind}/\${`), stripComments(list));
    }
  });

  suite('activity flow: the shared screen offers Start, and a way to stop', () => {
    const screen = readComponent('guided', 'guided-activity-screen.tsx');
    const code = stripComments(screen);

    check('it offers a Start action', /title=\{snapshot\.finished \? 'Start again' : 'Start'\}/.test(code), code);
    check('it can pause', code.includes("'Pause'"));
    check('it can resume', code.includes("'Resume'"));
    check('it can end early', code.includes('title="End"'));
    check('the pause and end controls are large targets', /minHeight: 60/.test(fs.readFileSync(fromComponents('ui', 'button.tsx'), 'utf8')));
  });

  suite('camera steps: the shared screen drives the existing pose pipeline', () => {
    /*
     * The registry suites prove a step's cameraConfigId RESOLVES. None of them
     * can see the screen that consumes it. If the shared screen stopped
     * resolving through the guided registry, stopped building the session
     * engine for a yoga step, or stopped mounting the native pose view, every
     * registry test would stay green while the camera silently never appeared
     * for a step like Chair Yoga Flow's "Stand and Sit" — the same failure
     * shape as the original dangling sit-to-stand id, one layer further up.
     */
    const code = stripComments(readComponent('guided', 'guided-activity-screen.tsx'));

    check(
      'a step resolves its camera config through the guided registry',
      code.includes('getGuidedPoseConfig(snapshot.currentStep.cameraConfigId)'),
    );
    check(
      'a camera step builds the shared session engine',
      code.includes('cameraEngineRef.current = new SessionEngine(currentStepConfig)'),
    );
    check(
      'the preview waits for permission and for the engine',
      code.includes('hasCameraPermission === true') && code.includes('hasCameraEngine'),
    );
    check(
      'the preview only mounts while a camera step is running',
      code.includes('showCameraPreview &&'),
    );
    check(
      'the preview is the existing native pose view, not a second camera',
      code.includes('<PoseTrackerView') && code.includes('onPoseFrame={handlePoseFrame}'),
    );
    check(
      'pose frames are fed to the engine',
      code.includes('const result = engine.handlePoseFrame(event)'),
    );
    check(
      'the voice layer reads the engine result',
      code.includes('voiceRef.current?.onFrame(result)'),
    );
  });

  suite('meditation camera stage: frames go to the posture tracker, never the rep engine', () => {
    /*
     * Meditation's camera stage has no repetition to count, so the shared
     * screen recognises the kind, gives those frames to
     * MeditationPostureTracker, and never builds a SessionEngine for it. Each
     * line below guards a property whose absence would silently disable or
     * corrupt the meditation camera while every registry test stayed green:
     * the preview must not wait for an engine meditation never creates, the
     * meditation branch must run before the engine and voice-on-frame paths,
     * and the tracker's own sentence must be what the HUD shows.
     */
    const code = stripComments(readComponent('guided', 'guided-activity-screen.tsx'));

    check(
      'the screen recognises a meditation by its kind',
      code.includes("const isMeditation = activity.kind === 'meditation'"),
    );
    check(
      'the preview does not wait for an engine meditation never builds',
      code.includes('isMeditation || hasCameraEngine'),
    );
    check(
      'no session engine is built for a meditation camera step',
      code.includes('isCameraStep && currentStepConfig && !isMeditation'),
    );
    const meditationBranch = code.indexOf('if (isMeditation)');
    check(
      'meditation frames branch before the engine path',
      meditationBranch !== -1 && meditationBranch < code.indexOf('engine.handlePoseFrame(event)'),
      meditationBranch,
    );
    check(
      'frames are handed to the posture tracker with the step own expectation',
      code.includes('postureTrackerRef.current.observe(') &&
        code.includes("snapshot.currentStep?.postureExpectation ?? 'in-frame'"),
    );
    check(
      'the tracker result is what the posture HUD shows',
      code.includes('setPostureGuidance(') &&
        code.includes("postureGuidance?.text ?? 'Camera starting up'"),
    );
    check(
      'meditation frames return before the voice-on-frame path',
      meditationBranch !== -1 && meditationBranch < code.indexOf('voiceRef.current?.onFrame(result)'),
      meditationBranch,
    );
    check(
      'each stage speaks its own guidance once, guarded by step index',
      code.includes("voiceRef.current?.consider('ready', step.guidance)") &&
        code.includes('announcedStepRef.current === snapshot.stepIndex'),
    );
    check(
      'nothing is spoken before Start or after the session ends',
      code.includes('if (!running || step === null) return;'),
    );
    check(
      'pause and resume are announced once each, as transitions',
      code.includes('voiceRef.current?.announcePause();') &&
        code.includes('voiceRef.current?.announceResume();'),
    );
    check(
      'camera permission is only requested for activities that use it',
      code.includes('if (!usesCamera) return;'),
    );
    check(
      'a denied camera leaves an optional placeholder on meditation',
      code.includes('<CameraPlaceholder optional={isMeditation} />'),
    );
  });

  suite('exercise library: the detail screen offers this exercise its own history', () => {
    /*
     * The library's loop is choose, do, review — and the review half was only
     * reachable from the Progress tab's mixed list, which cannot answer "how
     * did THIS one go". These checks guard the wiring that closes that gap:
     * the detail screen reads the real store, filters to itself through the
     * one selector, and reopens rows through the same result screen a live
     * finish uses. The shared list must also keep its whole-history behaviour
     * unchanged when no exercise is named.
     */
    const detail = stripComments(read('exercise', '[id].tsx'));
    check(
      'the detail screen reads the real session store',
      detail.includes("from '@/exercise/session-storage'") && detail.includes('store={sessionStore}'),
    );
    check("it lists only this exercise's sessions", detail.includes('exerciseId={exercise.id}'));
    check('the section is labelled', detail.includes('title="Your sessions"'));
    check(
      'a row reopens the existing result screen',
      detail.includes("pathname: '/exercise/result'"),
    );
    check(
      'the reopened values are the same formatted params Progress uses',
      detail.includes('formatDurationLabel(') &&
        detail.includes('formatPaceLabel(') &&
        detail.includes('formatRangeLabel(') &&
        detail.includes('formatConsistencyLabel('),
    );

    const historyCode = stripComments(readComponent('session', 'session-history.tsx'));
    check(
      'the shared list filters through the one selector',
      historyCode.includes('sessionsForExercise(records, exerciseId)'),
    );
    check(
      'without a filter it keeps the whole history',
      historyCode.includes('exerciseId === undefined ? records'),
    );
    check(
      'the whole-history empty state is unchanged',
      historyCode.includes('Finish an exercise, a yoga routine, or a calm moment'),
    );
    check(
      'the kept-on-device note still counts the whole history',
      historyCode.includes('All ${records.length} sessions are kept on this device'),
    );
  });

  // ==========================================================================
  // Task 6: one progress system, and no invented numbers
  // ==========================================================================
  suite('progress: guided sessions are counted but never scored', () => {
    const now = new Date();
    const today = now.toISOString();

    const guided: ProgressInput[] = guidedCatalog('wellness').map((activity, index) => ({
      id: `g${index}`,
      completedAt: today,
      consistencyPct: null,
      activityKind: activity.kind,
    }));

    const summary = buildProgress(guided, now);

    check('they are counted as sessions', summary.sessionsInWindow === guided.length, summary.sessionsInWindow);
    check('they are counted as guided', summary.guidedInWindow === guided.length, summary.guidedInWindow);
    check('nothing is plotted', summary.points.length === 0, summary.points.length);
    check('nothing is scored', summary.scoredInWindow === 0);
    check('there is no latest score', summary.latest === null);
    check('there is no average', summary.average === null);
    check('there is no high', summary.highest === null);
    check('there is no low', summary.lowest === null);
  });

  suite('progress: a real exercise session still scores exactly as before', () => {
    // The whole point of the guidance work is that the camera pipeline is
    // untouched. Two reps of the same range produce the same steadiness as they
    // always did, through the same code path.
    const metrics: SessionMetrics = buildSessionMetrics({
      reps: 2,
      durationSeconds: 20,
      repRanges: [80, 80],
      rangeMinDeg: 80,
      rangeMaxDeg: 80,
    });
    const summary = buildProgress(
      [{ id: 'e1', completedAt: new Date().toISOString(), consistencyPct: metrics.consistencyPct }],
      new Date(),
    );

    check('it is plotted', summary.points.length === 1, summary.points.length);
    check('it is scored', summary.scoredInWindow === 1);
    check('it is not counted as guided', summary.guidedInWindow === 0);
    check('the score is the existing steadiness value', summary.latest?.score === metrics.consistencyPct, summary.latest?.score);
  });

  suite('progress: a guided session and a camera session coexist', () => {
    const now = new Date();
    const iso = now.toISOString();
    const summary = buildProgress(
      [
        { id: 'a', completedAt: iso, consistencyPct: 90 },
        { id: 'b', completedAt: iso, consistencyPct: null, activityKind: 'yoga' },
        { id: 'c', completedAt: iso, consistencyPct: 40, activityKind: undefined },
        { id: 'd', completedAt: iso, consistencyPct: null, activityKind: 'meditation' },
      ],
      now,
    );

    check('all four are sessions', summary.sessionsInWindow === 4, summary.sessionsInWindow);
    check('two of them are guided', summary.guidedInWindow === 2, summary.guidedInWindow);
    check('both camera sessions are plotted', summary.points.length === 2, summary.points.length);
    check('the average is of the camera sessions only', summary.average === 65, summary.average);
  });

  suite('progress: nothing anywhere invents a measurement for a guided session', () => {
    // A guided record written by the shared screen must be structurally incapable
    // of carrying a score, not merely happen to have null in it.
    const activity = guidedCatalog('meditation')[0];
    const metrics = buildSessionMetrics({
      reps: 0,
      durationSeconds: 60,
      repRanges: [],
      rangeMinDeg: null,
      rangeMaxDeg: null,
    });

    const record = createSessionRecord({
      id: 'r1',
      exerciseId: activity.id,
      exerciseName: activity.name,
      completedAt: new Date().toISOString(),
      metrics,
      activityKind: activity.kind,
      stepsCompleted: 3,
    });

    check('reps are a real zero, not a hidden measurement', record.reps === 0);
    check('there is no pace', record.paceRpm === null);
    check('there is no range', record.rangeMinDeg === null && record.rangeMaxDeg === null);
    check('there is no steadiness', record.consistencyPct === null);
    check('it carries its kind', record.activityKind === activity.kind);
    check('it carries its step count', record.stepsCompleted === 3);

    const roundTripped = parseSessionRecord(JSON.parse(JSON.stringify(record)));
    check('it survives a round trip through storage', roundTripped?.activityKind === activity.kind);
    check('and still has no score after the round trip', roundTripped?.consistencyPct === null);
  });

  suite('session history: a guided row is described by its own steps', () => {
    const activity = guidedCatalog('yoga')[0];
    const record = createSessionRecord({
      id: 'r1',
      exerciseId: activity.id,
      exerciseName: activity.name,
      completedAt: new Date().toISOString(),
      metrics: buildSessionMetrics({ reps: 0, durationSeconds: 90, repRanges: [], rangeMinDeg: null, rangeMaxDeg: null }),
      activityKind: activity.kind,
      stepsCompleted: 2,
    });

    const described = describeSessionOutcome(record);
    check('it says how many of how many', described === `2 of ${activity.steps.length} poses`, described);
    check('it uses the activity own noun, not "steps"', !/\bsteps\b/.test(described), described);
    check('it never says zero exercises', !/0 exercises/.test(described), described);
  });

  // ==========================================================================
  // Task 7: the screens stay calm and honest
  // ==========================================================================
  suite('activity screens: nothing claims a measurement that was not made', () => {
    const files = [
      ['yoga', read('yoga.tsx')],
      ['meditation', read('meditation.tsx')],
      ['wellness', read('wellness.tsx')],
      ['activity-result', read('activity-result.tsx')],
      ['guided screen', readComponent('guided', 'guided-activity-screen.tsx')],
    ] as const;

    for (const [name, source] of files) {
      const words = stripComments(source);
      for (const claim of ['steadiness', 'score', 'accuracy', 'range of motion', 'degrees']) {
        check(`${name} does not claim a ${claim}`, !new RegExp(claim, 'i').test(words), words);
      }
      check(`${name} makes no medical claim`, !/health|medical|diagnos|rehab|therap|symptom|patient/i.test(words), words);
      check(`${name} makes no AI claim`, !/\bAI\b|artificial intelligence|machine learning/i.test(words), words);
    }
  });

  suite('activity screens: no emoji and no neon', () => {
    for (const [name, source] of [
      ['yoga', read('yoga.tsx')],
      ['meditation', read('meditation.tsx')],
      ['wellness', read('wellness.tsx')],
      ['activity-result', read('activity-result.tsx')],
      ['guided screen', readComponent('guided', 'guided-activity-screen.tsx')],
    ] as const) {
      const words = stripComments(source);
      const emoji = words.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      check(`${name} has no emoji`, emoji === null, emoji?.[0]);
      check(`${name} has no purple`, !/purple|violet|neon|magenta|#8B5CF6|#A855F7/i.test(words), words);
    }
  });

  suite('activity screens: durations come from the catalogue, never typed in', () => {
    for (const kind of ['yoga', 'meditation', 'wellness'] as const) {
      const list = read(`${kind}.tsx`);
      check(`${kind} reads its lengths from the catalogue`, list.includes('guidedCatalog'), list);
      check(`${kind} types no duration inline`, !/\b\d+\s*(sec|min|minutes|seconds)\b/.test(stripComments(list)), stripComments(list));
    }
  });

  // ==========================================================================
  // Task 8/9: the navigation and Family are untouched
  // ==========================================================================
  suite('navigation: the four tabs and the stack routes are exactly as they were', () => {
    const layout = read('_layout.tsx');
    // The tab bar itself lives in app-tabs; the layout file only renders it.
    const appTabs = fs.readFileSync(fromComponents('app-tabs.tsx'), 'utf8');
    const tabCode = stripComments(appTabs);

    for (const tab of ['index', 'activities', 'progress', 'family']) {
      check(`the ${tab} tab still exists`, exists('(tabs)', `${tab}.tsx`), tab);
    }
    check('the tab bar still lists exactly four screens', tabCode.split('name=').length - 1 === 4, tabCode);
    for (const tab of ['index', 'activities', 'progress', 'family']) {
      check(`the tab bar still shows the ${tab} screen`, tabCode.includes(`name="${tab}"`), tab);
    }
    check('no activity was given a tab', !/name="(yoga|meditation|wellness|exercise)"/.test(tabCode), tabCode);

    for (const route of ['exercise/index', 'yoga', 'meditation', 'wellness', 'settings/index']) {
      check(`${route} is still a stack route`, layout.includes(`name="${route}"`), route);
    }
    check('the bottom bar is not given a new entry by this work', !/name="(yoga|meditation|wellness)"[\s\S]{0,200}tabBarIcon/.test(layout));
  });

  suite('family: still an honest empty state, with no invented accounts', () => {
    const family = readComponent('family', 'family-screen.tsx');
    const words = stripComments(family);

    check('it still says there are none', family.includes('No family members yet'));
    check('it still says nothing was added', /nothing was added/i.test(family));
    check('it invents no member', !/member:\s*\{|name:\s*'|phone:\s*['"]\d/.test(words), words);
    check('it has no network client', !/fetch\(|axios|https?:\/\//.test(words), words);
  });

  suite('privacy: the delete action is the real store, not a local flag', () => {
    const privacy = read('settings', 'privacy.tsx');
    const code = stripComments(privacy);

    check('it deletes through the session store', code.includes('sessionStore') && code.includes('clearSessions'), code);
    check('it does not pretend to be encrypted', !/encrypt/i.test(code), code);
    check('it does not claim a server or backup', !/(server|cloud|upload|backup)/i.test(code), code);
    check('it still keeps the camera facts', /only when you start an exercise session/i.test(privacy));
  });

  suite('appearance: the choice is stored, applied, and reversible', () => {
    const appearance = read('settings', 'appearance.tsx');
    const code = stripComments(appearance);
    const theme = fs.readFileSync(fromSrc('hooks', 'use-theme.ts'), 'utf8');
    const rootLayout = read('_layout.tsx');

    check('it stores the choice', code.includes('setPreference('), code);
    check('it reads the stored choice', code.includes('useThemePreference()'), code);
    check('every screen resolves through the stored preference', /preference === 'light'/.test(theme) && /preference === 'dark'/.test(theme), theme);
    check('system still defers to the phone', /Colors\[deviceScheme === 'dark' \? 'dark' : 'light'\]/.test(theme), theme);
    check('the navigator follows the same choice', rootLayout.includes('preference === \'system\''), rootLayout);
    check('the provider sits above the navigator', rootLayout.indexOf('ThemePreferenceProvider') < rootLayout.indexOf('<Stack>'), rootLayout);
  });

  // ==========================================================================
  // The shared engine holds up on its own
  // ==========================================================================
  suite('guided activities: a step is only as long as the catalogue says', () => {
    for (const kind of ['yoga', 'meditation', 'wellness'] as const) {
      for (const activity of guidedCatalog(kind)) {
        check(`${activity.id} duration is its own steps added up`, totalStepSeconds(activity.steps) === activity.durationSeconds, activity.durationSeconds);
      }
    }
  });

  suite('activity list: the wellness day view is built from the real history', () => {
    const wellness = read('wellness.tsx');
    const code = stripComments(wellness);

    check('it reads the session store', code.includes('sessionStore.getSessions()'), code);
    check('it derives today rather than storing a tick', code.includes('todayStatus('), code);
    check('it has no second storage key of its own', !/AsyncStorage|setItem|getItem/.test(code), code);
    check('it says nothing before the history has been read', /counts === null \? null/.test(code), code);
    check('it offers no way to tick something by hand', !/markDone|toggleDone|onToggle/.test(code), code);
    check('a day view still works with no done ids', guidedActivitiesForDay('wellness', []).every((e) => !e.done));
  });

  suite('saving a session: the result screen only ever claims a write that landed', () => {
    /*
     * The wording itself is unit tested in activities.test.ts. What no unit test
     * can reach is the WIRING: this harness has no React renderer, so nothing
     * exercises the screen bodies. If the guided screen went back to swallowing
     * the rejection, or stopped passing the outcome on, every save-status test
     * would still pass while a failed write rendered "Yes" again.
     */
    const screen = stripComments(readComponent('guided', 'guided-activity-screen.tsx'));
    const result = stripComments(read('activity-result.tsx'));

    check('the guided screen waits for the write instead of discarding it', /await sessionStore\.saveSession\(record\)/.test(screen), screen);
    check('it no longer fires the write away and swallows it', !/void sessionStore\.saveSession/.test(screen), screen);
    check(
      'the write outcome becomes the status it reports',
      /let saveStatus[^=]*= 'failed'/.test(screen) &&
        /await sessionStore\.saveSession\(record\);\s*saveStatus = 'saved'/.test(screen),
      screen,
    );
    check('it passes that outcome to the result screen', /saved: saveStatus/.test(screen), screen);

    check('the result screen reads the reported outcome', /parseSaveStatusParam\(saved\)/.test(result), result);
    check('it phrases the save from that outcome', /describeSaveStatus\(/.test(result), result);
    check('it no longer decides the save from how the session ended', !/ranToTheEnd \? 'Yes'/.test(result), result);
    check('no bare Yes is left beside the save row', !/label="Saved to your history"\s*value="Yes/.test(result), result);
  });
}
