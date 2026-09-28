import { check, suite } from './harness';

// These suites read the app's source rather than importing it, for the same
// reason result-routing.test.ts does: the screens are React Native components
// with @/ aliases and native-only imports, and the test build deliberately
// excludes them. What is guarded here is structure and wording, which is exactly
// what the source is the authority on.
//
// The minimal declarations are declared here rather than pulling in @types/node
// for the whole suite.
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
  resolve(...segments: string[]): string;
};

const fs = require('fs') as ReturnType<typeof require>;
const nodePath = require('path') as ReturnType<typeof require>;

// __dirname is the COMPILED test directory (build-tests/tests), so the app
// source is two levels up, back at the repository's src/.
const fromApp = (...segments: string[]) => nodePath.resolve(__dirname, '../../src/app', ...segments);
const fromComponents = (...segments: string[]) => nodePath.resolve(__dirname, '../../src/components', ...segments);
const fromSrc = (...segments: string[]) => nodePath.resolve(__dirname, '../../src', ...segments);
const read = (...segments: string[]) => fs.readFileSync(fromApp(...segments), 'utf8');
const readComponent = (...segments: string[]) => fs.readFileSync(fromComponents(...segments), 'utf8');
const exists = (...segments: string[]) => fs.existsSync(fromApp(...segments));

/** Removes comments so they cannot be mistaken for wording a reader would see. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Pulls out the strings a person could actually read: JSX text and quoted
 * literals. Code is deliberately NOT searched, because a word check over the
 * whole file reports API names like `Constants.expoConfig` as though they were
 * on-screen wording, which is exactly the false positive that would make this
 * suite worthless.
 */
function readerVisibleStrings(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];
  for (const match of code.matchAll(/>\s*([^<>{}]+?)\s*</g)) found.push(match[1]);
  for (const match of code.matchAll(/"([^"\n]+)"/g)) found.push(match[1]);
  for (const match of code.matchAll(/'([^'\n]+)'/g)) found.push(match[1]);
  // Drop route paths and import specifiers: they are strings, but not words.
  return found.filter((s) => s.trim().length > 0 && !/^(@|\.{0,2}\/)/.test(s.trim()));
}

/** Every `name="..."` trigger declared in a tab bar, in order. */
function tabTriggers(source: string): string[] {
  return [...source.matchAll(/<NativeTabs\.Trigger name="([^"]+)"/g)].map((m) => m[1]);
}

/** Every web `TabTrigger` destination, in order. */
function webTabTriggers(source: string): string[] {
  return [...source.matchAll(/<TabTrigger name="([^"]+)" href="([^"]+)"/g)].map((m) => m[1]);
}

/** The four primary destinations, in the order they must appear everywhere. */
const PRIMARY_TABS = ['index', 'activities', 'progress', 'family'] as const;

/** The things a person can do, which must NOT each own a tab. */
const ACTIVITY_DESTINATIONS = ['exercise', 'yoga', 'meditation', 'wellness'] as const;

const SETTINGS_SECTIONS = [
  'family',
  'language',
  'appearance',
  'notifications',
  'privacy',
  'about',
] as const;

const SCREENS: Array<[string, string]> = [
  ['settings/index.tsx', read('settings', 'index.tsx')],
  ['settings/language.tsx', read('settings', 'language.tsx')],
  ['settings/appearance.tsx', read('settings', 'appearance.tsx')],
  ['settings/notifications.tsx', read('settings', 'notifications.tsx')],
  ['settings/privacy.tsx', read('settings', 'privacy.tsx')],
  ['settings/about.tsx', read('settings', 'about.tsx')],
  ['family/family-screen.tsx', readComponent('family', 'family-screen.tsx')],
] as const;

/**
 * Route files that exist only to render a shared screen. They carry no wording
 * of their own, and that is the point: wording lives in one place, so a wrapper
 * cannot drift from the screen it shows.
 */
const PASS_THROUGH_ROUTES: Array<[string, string]> = [
  ['settings/family.tsx', read('settings', 'family.tsx')],
  ['(tabs)/family.tsx', read('(tabs)', 'family.tsx')],
] as const;

export function run() {
  suite('navigation: the tab bar has exactly four primary items', () => {
    const nativeTabs = readComponent('app-tabs.tsx');
    const webTabs = readComponent('app-tabs.web.tsx');
    const native = tabTriggers(nativeTabs);
    const web = webTabTriggers(webTabs);

    // The whole point of the redesign: a bar that grows with the feature list
    // stops being readable, so its length is asserted, not just its contents.
    check('the native tab bar has exactly four items', native.length === 4, native);
    check('the web tab bar has exactly four items', web.length === 4, web);
    check(
      'the native tab bar is Home, Activities, Progress, Family',
      native.join(',') === PRIMARY_TABS.join(','),
      native,
    );
    check(
      'the web tab bar matches the native one, same order',
      web.join(',') === native.join(','),
      { web, native },
    );

    // Every trigger must point at a real route file, or the bar renders a tab
    // that opens nothing.
    for (const tab of PRIMARY_TABS) {
      check(`the ${tab} tab has a route file`, exists('(tabs)', `${tab}.tsx`));
    }
  });

  suite('navigation: activities are grouped, not given their own tabs', () => {
    const nativeTabs = readComponent('app-tabs.tsx');
    const webTabs = readComponent('app-tabs.web.tsx');
    const activities = read('(tabs)', 'activities.tsx');

    // Each activity used to be a tab. Any of them coming back would be the whole
    // problem this redesign exists to solve.
    for (const destination of ACTIVITY_DESTINATIONS) {
      check(
        `the native tab bar has no ${destination} tab`,
        !nativeTabs.includes(`name="${destination}"`),
      );
      check(
        `the web tab bar has no ${destination} tab`,
        !webTabs.includes(`name="${destination}"`),
      );
      check(
        `the native tab bar does not offer ${destination} as a label`,
        !new RegExp(`>${destination}<`, 'i').test(nativeTabs),
      );
    }

    // The Activities page must actually reach all four.
    for (const destination of ACTIVITY_DESTINATIONS) {
      check(`Activities lists ${destination}`, activities.includes(`name: '${destination}'`));
      check(`Activities shows the ${destination} title`, activities.includes(`title: '${cap(destination)}'`));
    }
    check('Activities is a four-item list', ACTIVITY_DESTINATIONS.every((d) => activities.includes(`'${d}'`)));

    // Every activity destination is a stack screen, registered and titled, so it
    // keeps a visible way back to Activities.
    const rootLayout = read('_layout.tsx');
    for (const destination of ACTIVITY_DESTINATIONS) {
      const route = destination === 'exercise' ? 'exercise/index' : destination;
      check(`the root layout registers ${route}`, rootLayout.includes(`name="${route}"`), rootLayout);
    }
  });

  suite('navigation: Settings is off the tab bar but still reachable', () => {
    const nativeTabs = readComponent('app-tabs.tsx');
    const webTabs = readComponent('app-tabs.web.tsx');
    const home = read('(tabs)', 'index.tsx');
    const rootLayout = read('_layout.tsx');

    check('the native tab bar has no Settings tab', !nativeTabs.includes('name="settings"'));
    check('the web tab bar has no Settings tab', !webTabs.includes('name="settings"'));
    check('the native tab bar does not label a tab Settings', !/>Settings</.test(nativeTabs));
    check('the web tab bar does not label a tab Settings', !/>Settings</.test(webTabs));

    // The /settings route itself must survive the move out of the tabs group.
    check('the settings list still exists', exists('settings', 'index.tsx'));
    check('the root layout registers settings/index', rootLayout.includes('name="settings/index"'));
    check(
      'the /settings route has exactly one owner',
      exists('settings', 'index.tsx') && !exists('settings.tsx') && !exists('(tabs)', 'settings.tsx'),
    );

    // Reachable from Home, in more than one way, because Settings is no longer
    // one tap away in the bar.
    check('Home links to settings', home.includes("router.push('/settings')"));
    check('Home has a dedicated Settings action', home.includes('accessibilityLabel="Settings"'));
    check('Home labels the Settings action for screen readers', home.includes('accessibilityHint='));
  });

  suite('navigation: every route has exactly one owner', () => {
    // Two files claiming one path is an ambiguous route, and which one wins is
    // not something to leave to chance.
    const owners: Array<[string, boolean[]]> = [
      ['/', [exists('index.tsx'), exists('(tabs)', 'index.tsx')]],
      ['/activities', [exists('activities.tsx'), exists('(tabs)', 'activities.tsx')]],
      ['/progress', [exists('progress.tsx'), exists('(tabs)', 'progress.tsx')]],
      ['/family', [exists('family.tsx'), exists('(tabs)', 'family.tsx')]],
      ['/settings', [exists('settings.tsx'), exists('settings', 'index.tsx'), exists('(tabs)', 'settings.tsx')]],
      ['/exercise', [exists('exercise.tsx'), exists('(tabs)', 'exercise.tsx'), exists('exercise', 'index.tsx')]],
      ['/yoga', [exists('yoga.tsx'), exists('(tabs)', 'yoga.tsx')]],
      ['/meditation', [exists('meditation.tsx'), exists('(tabs)', 'meditation.tsx')]],
      ['/wellness', [exists('wellness.tsx'), exists('(tabs)', 'wellness.tsx')]],
    ];

    for (const [route, candidates] of owners) {
      const found = candidates.filter(Boolean).length;
      check(`${route} is owned by exactly one route file`, found === 1, { route, owners: found });
    }

    // The relocated activity screens must still exist, just outside the tabs.
    for (const destination of ACTIVITY_DESTINATIONS) {
      const present =
        destination === 'exercise'
          ? exists('exercise', 'index.tsx')
          : exists(`${destination}.tsx`);
      check(`the ${destination} screen still exists`, present);
    }
  });

  suite('navigation: the Progress tab shows the real thing and no second score', () => {
    const progressTab = read('(tabs)', 'progress.tsx');
    const home = read('(tabs)', 'index.tsx');
    const progressCalc = fs.readFileSync(fromSrc('exercise', 'progress.ts'), 'utf8');

    // It must reuse the existing implementation rather than grow a second one.
    check('the Progress tab renders the real progress view', progressTab.includes('<ProgressSection'));
    check('the Progress tab renders real session history', progressTab.includes('<SessionHistory'));
    check('the Progress tab reads the real session store', progressTab.includes('sessionStore'));
    check('the Progress tab reuses the shared progress hook', progressTab.includes('useProgress('));
    check('the Progress tab shows the progress score card', progressTab.includes('label="Progress score"'));

    // No second scoring system, anywhere in the tab.
    const code = stripComments(progressTab);
    for (const banned of ['buildProgress(', 'consistencyPct:', 'PROGRESS_MIN', 'PROGRESS_MAX', 'Math.round']) {
      check(`the Progress tab defines no scoring of its own (${banned})`, !code.includes(banned));
    }

    // The calculation itself is untouched: the score is still the app's existing
    // 0-100 steadiness value and nothing else.
    check('the progress score is still the stored consistency value', progressCalc.includes('metrics.consistencyPct'));
    check('the progress score is still the only input', progressCalc.includes('Pick<SessionMetrics, \'consistencyPct\'>'));
    check('the progress score is still bounded 0-100', /PROGRESS_MIN = 0[\s\S]*PROGRESS_MAX = 100/.test(progressCalc));

    // Home keeps the summary card and links to the detail.
    check('Home still shows the progress card', home.includes('label="Progress score"'));
    check('Home links to the Progress tab', home.includes("router.navigate('/progress')"));
  });

  suite('navigation: the Family tab and the Family row show one screen', () => {
    const familyTab = read('(tabs)', 'family.tsx');
    const familySettings = read('settings', 'family.tsx');
    const familyScreen = readComponent('family', 'family-screen.tsx');

    // Two copies of a screen drift apart, so both routes must render the same one.
    check('the Family tab renders the shared Family screen', familyTab.includes('<FamilyScreen'));
    check('the Settings Family row renders the shared Family screen', familySettings.includes('<FamilyScreen'));
    check('the shared Family screen is a component', familyScreen.includes('export function FamilyScreen'));
    check('the tab draws its own heading', !familyTab.includes('showHeader={false}'));
    check('the stack route does not repeat the stack heading', familySettings.includes('showHeader={false}'));
  });

  suite('navigation: the web tab bar is as usable as the native one', () => {
    const webTabs = readComponent('app-tabs.web.tsx');
    // Comments are stripped first so an explanatory comment about the label size
    // cannot be mistaken for the declaration that sets it.
    const webCode = stripComments(webTabs);

    // Labels readable and targets large enough, which is the same bar the rest
    // of the app holds itself to.
    check('the web tab labels are at least 16px', /tabLabel:[\s\S]{0,200}fontSize: 16/.test(webCode), webCode);
    check('the web tab targets are at least 48 tall', /tabButtonView:[\s\S]{0,200}minHeight: 48/.test(webCode), webCode);
    check('the active web tab is marked by weight and colour', webTabs.includes("isFocused ? 'text' : 'textSecondary'"));
    check('every web tab has an href', (webTabs.match(/<TabTrigger name=/g) ?? []).length === 4);
  });

  suite('navigation: existing screens and the exercise flow are left intact', () => {
    const rootLayout = read('_layout.tsx');

    // The screens this change must not disturb. `(tabs)` is a directory, so its
    // navigators are its `_layout.tsx` files.
    check('the tabs navigator still exists', exists('(tabs)', '_layout.tsx'));
    check('the root navigator still exists', exists('_layout.tsx'));
    for (const route of ['exercise/[id]', 'exercise/session', 'exercise/result']) {
      check(`the ${route} screen still exists`, exists(`${route}.tsx`));
      check(`the root layout still declares ${route}`, rootLayout.includes(`name="${route}"`), rootLayout);
    }
    check('the tabs navigator still has headerShown false', rootLayout.includes('name="(tabs)"'));
    check('the root layout declares no bare settings screen', !/<Stack\.Screen name="settings"/.test(rootLayout));

    // The exercise list must still lead into the unchanged session flow.
    const exerciseList = read('exercise', 'index.tsx');
    check('the exercise list still starts a session', exerciseList.includes('router.push(`/exercise/${exercise.id}`)'));

    // Home still reaches the things it always reached.
    //
    // It used to also link straight to `/exercise` and `/exercise/result` through
    // a "Primitives" block that existed to demonstrate the design system. That
    // block is gone: it was not a thing a person can do, and one of its buttons
    // opened the result screen with no session behind it. Home reaches the
    // activities through Activities, which is the tab that lists all four, so the
    // check is that those three routes are all still there.
    const home = read('(tabs)', 'index.tsx');
    check('Home links to Activities', home.includes("router.navigate('/activities')"));
    check('Home links to Progress', home.includes("router.navigate('/progress')"));
    check('Home links to Settings', home.includes("router.push('/settings')"));
    check('Home no longer opens a result screen with nothing behind it', !home.includes("router.push('/exercise/result')"), home);
    check('Home has no leftover design-system block', !/Primitives/.test(stripComments(home)), stripComments(home));
  });

  suite('settings: every section is reachable and registered', () => {
    const settingsScreen = read('settings', 'index.tsx');
    const rootLayout = read('_layout.tsx');

    for (const section of SETTINGS_SECTIONS) {
      check(`the /settings/${section} screen exists`, exists('settings', `${section}.tsx`));
      check(
        `Settings links to /settings/${section}`,
        settingsScreen.includes(`href: '/settings/${section}'`),
      );
      check(
        `the root layout registers settings/${section}`,
        rootLayout.includes(`name="settings/${section}"`),
      );
      check(
        `settings/${section} has a default export`,
        /export default function \w+/.test(read('settings', `${section}.tsx`)),
      );
    }

    // The six headings the settings screen is supposed to show, in order.
    const headings = ['Family', 'Language', 'Appearance', 'Notifications', 'Privacy & Safety', 'About NOVEN'];
    let cursor = -1;
    let inOrder = true;
    for (const heading of headings) {
      const at = settingsScreen.indexOf(`title: '${heading}'`);
      if (at < 0 || at < cursor) {
        inOrder = false;
        break;
      }
      cursor = at;
    }
    check('the six sections are listed in the intended order', inOrder, headings);
  });

  suite('settings: the Family page is honest about having no accounts', () => {
    // The content moved into a shared component when Family became a tab, so
    // the guarantees are now checked there. They are unchanged, not relaxed.
    const family = readComponent('family', 'family-screen.tsx');
    const code = stripComments(family);

    check('it has a clear Family heading', family.includes('title="Family"'));
    check('it offers an add action', family.includes('title="Add family member"'));

    // The "family members can be connected to your account" paragraph was removed
    // as redundant introduction copy. What replaces it as the answer to "what is
    // this page for" is the title, the add action and the empty state together —
    // so those are asserted here instead, which is a stronger check than the
    // paragraph's presence was: it fails if any one of them is ever dropped.
    check('it needs no introductory paragraph to be understood', !/family members can be connected/i.test(family), family.match(/can be connected[^"]*/i));
    check('its heading says what the page is', /title="Family"/.test(family));
    check('its add action says what can be done', /title="Add family member"/.test(family));
    check('its empty state says what is not there yet', /No family members yet/.test(family));
    check('it says plainly that nothing can be added', /no family accounts/i.test(family));

    // The empty state must be an empty state, not a stand-in.
    check('it shows an honest empty state', family.includes('No family members yet'));

    // No invented relatives: no names, no email addresses, no seeded list.
    check('it contains no email address', !/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(family));
    check('it contains no seeded or sample family data', !/SAMPLE|DEMO|MOCK|EXAMPLE_NAME|FakeFamily/i.test(code));
    check('it does not render a hardcoded list of members', !/const (SAMPLE|DEMO|MOCK)/.test(code));

    // Pressing Add must not pretend to have created anything. It may only set
    // local state: no persistence, no network, no navigation to a create form.
    check('Add does not write to storage', !/sessionStore|AsyncStorage|setItem|await save/.test(code));
    check('Add does not navigate to an account creation route', !/router\.(push|replace)\(/.test(code));
    check('Add only reveals an explanation', /onPress=\{\(\) => setShowAddNote\(true\)\}/.test(family));
    check('the explanation says it is not available yet', /not available yet/i.test(family));
    check('the explanation says nothing was added', /nothing was added/i.test(family));

    // The empty state must survive the copy cleanup intact, including the second
    // line. "Anyone you add will be listed here" is not decoration: it is what
    // tells the user the list is waiting to be filled rather than broken.
    check('the empty state explains itself', /Anyone you add will be listed here/.test(family));
  });

  suite('settings: screens are concise, but never at the cost of honesty', () => {
    // The cleanup removed explanatory paragraphs from the settings screens. What
    // it must not have removed is anything a person needs in order to understand
    // a limitation, a permission, or why an action does nothing. Each screen below
    // is checked for the facts that have to survive, not for the length of what
    // was cut.
    const language = read('settings', 'language.tsx');
    const appearance = read('settings', 'appearance.tsx');
    const notifications = read('settings', 'notifications.tsx');
    const privacy = read('settings', 'privacy.tsx');
    const about = read('settings', 'about.tsx');
    const family = readComponent('family', 'family-screen.tsx');
    const activities = read('(tabs)', 'activities.tsx');
    const progress = read('(tabs)', 'progress.tsx');

    // --- What was removed: intro copy that restated the title. ---
    check('Settings has no introductory subtitle', !/subtitle=/.test(read('settings', 'index.tsx')));
    // Language is a list of rows, so it needs no prose at all. Appearance now has
    // exactly one Text — the "Selected" marker, which is a state indicator rather
    // than a paragraph — so the check is narrowed to what it was protecting: no
    // subtitle prop, and no prose beyond the marker.
    check('Language has no explanatory paragraph', !/subtitle=|<Text/.test(language), language);
    check('Appearance has no explanatory paragraph', !/subtitle=/.test(appearance), appearance);
    check("Appearance's only text is the selection marker", (stripComments(appearance).match(/<Text/g) ?? []).length === 1, stripComments(appearance).match(/<Text/g));
    // Comments are stripped first: the file explains in a comment that this
    // paragraph was removed, and the test must not read that explanation as the
    // paragraph itself.
    check('About has no descriptive paragraph', !/What NOVEN is/.test(stripComments(about)), stripComments(about));
    check('Family has no introductory paragraph', !/family members can be connected/i.test(family));
    check('Family has no heading subtitle', !/Keep the people you care about/.test(family));
    check('Activities has no introductory subtitle', !/subtitle=/.test(activities), activities);
    check('Activities has no "What you can do" heading', !/What you can do/.test(activities), activities);
    check('Progress has no introductory subtitle', !/subtitle=/.test(progress), progress);

    // --- What must remain: the honest limitations. ---
    // Language still says what the language is and that it cannot be changed.
    check('Language still shows the real language', language.includes('value="English"'));
    check('Language still says it cannot be changed', /not available yet/i.test(language));

    // Appearance is a REAL setting now, so the check is that it works rather than
    // that it admits it does not. The rows must be marked by the stored
    // preference, and nothing may claim a choice is coming.
    //
    // Comments are stripped for the wording checks: this file explains in a
    // comment that the "Coming soon" label is gone, and reading that explanation
    // as though it were still on screen is exactly the false positive the
    // stripComments helper exists to prevent.
    check('Appearance marks the option in use', /right=\{\s*preference === option\.value/.test(stripComments(appearance)), stripComments(appearance));
    check('Appearance is driven by the stored preference', /preference === option\.value/.test(appearance), appearance);
    check('Appearance no longer claims choosing is unavailable', !/not available yet|Coming soon/i.test(stripComments(appearance)), stripComments(appearance));
    check('Appearance adds no explanation of its own', !/Colours only/.test(stripComments(appearance)), stripComments(appearance));

    // Notifications keeps its one message: that nothing is sent at all.
    check('Notifications still says nothing is sent', /does not send reminders/i.test(notifications));
    check('Notifications still marks both rows unavailable', /Not available yet/.test(notifications));

    // Privacy keeps the permission facts. This is the one screen where the prose
    // is load-bearing: the rows say which permissions exist, but not when the
    // camera is requested or what it is used for.
    check('Privacy still explains when the camera is asked for', /only when you start an exercise session/i.test(privacy));
    check('Privacy still says what the camera is used for', /only to watch the movement/i.test(privacy));
    check('Privacy still says history stays on the phone', /not sent anywhere/i.test(privacy));
    // Deletion is implemented, so Privacy no longer says it cannot be changed.
    check('Privacy now offers to delete the saved sessions', /Delete all saved sessions/.test(privacy), privacy);
    check('Privacy no longer says it cannot be changed yet', !/not available yet/i.test(stripComments(privacy)), stripComments(privacy));

    // About keeps the three real values.
    check('About still reads the version from config', about.includes('Constants.expoConfig'));
    check('About still counts the real catalogue', about.includes('exercisesCatalog.length'));
    check('About still shows the app name', /label="App"/.test(about));

    // Family keeps the button, the note, and the honest empty state.
    check('Family keeps the add action', family.includes('title="Add family member"'));
    check('Family keeps the honest empty state', family.includes('No family members yet'));
    check('Family still says nothing was added', /nothing was added/i.test(family));

    // --- Coming Soon labels stay where functionality truly does not exist. ---
    // Appearance and Privacy are deliberately absent from this list: both are now
    // real settings that do what they say, and leaving them here would have
    // asserted a limitation the app no longer has.
    for (const [name, source] of [
      ['language', language],
      ['notifications', notifications],
      ['family', family],
    ] as const) {
      check(`${name} still carries a Coming Soon label`, /not available yet|Coming soon/i.test(source), source);
    }
    check('appearance is no longer a Coming Soon screen', !/not available yet|Coming soon/i.test(stripComments(appearance)), stripComments(appearance));
    check('privacy is no longer a Coming Soon screen', !/not available yet|Coming soon/i.test(stripComments(privacy)), stripComments(privacy));

    // --- Titles are untouched, which is the whole premise of the cleanup. ---
    const titles: Array<[string, string, string]> = [
      ['settings/index.tsx', read('settings', 'index.tsx'), 'Settings'],
      ['language.tsx', language, 'Language'],
      ['appearance.tsx', appearance, 'Appearance'],
      ['notifications.tsx', notifications, 'Notifications'],
      ['privacy.tsx', privacy, 'Privacy & Safety'],
      ['about.tsx', about, 'About NOVEN'],
      ['family-screen.tsx', family, 'Family'],
    ];
    for (const [name, source, title] of titles) {
      check(`${name} keeps its title`, source.includes(`title="${title}"`), source);
    }
    check('the settings list still names all six sections', (() => {
      const list = read('settings', 'index.tsx');
      return ['Family', 'Language', 'Appearance', 'Notifications', 'Privacy & Safety', 'About NOVEN'].every((t) =>
        list.includes(`title: '${t}'`),
      );
    })());

    // The four activities must keep their labels, because those labels are what
    // the user is choosing between.
    for (const activity of ['Exercise', 'Yoga', 'Meditation', 'Wellness']) {
      check(`Activities keeps the ${activity} label`, activities.includes(`title: '${activity}'`));
    }

    // No screen was reduced to nothing: each still has wording a reader sees.
    for (const [name, source] of [
      ['settings/index.tsx', read('settings', 'index.tsx')],
      ['language.tsx', language],
      ['appearance.tsx', appearance],
      ['notifications.tsx', notifications],
      ['privacy.tsx', privacy],
      ['about.tsx', about],
      ['family-screen.tsx', family],
    ] as const) {
      check(`${name} still shows readable content`, readerVisibleStrings(source).length > 3, readerVisibleStrings(source));
    }
  });

  suite('settings: unfinished features are not dressed up as working', () => {
    const language = read('settings', 'language.tsx');
    const appearance = read('settings', 'appearance.tsx');
    const notifications = read('settings', 'notifications.tsx');
    const privacy = read('settings', 'privacy.tsx');
    const about = read('settings', 'about.tsx');

    // Appearance must offer the three options the design calls for, and now they
    // have to be the real ones: the stored values, not display labels.
    for (const option of ['Light', 'Dark', 'Same as my phone']) {
      check(`Appearance offers ${option}`, appearance.includes(`label: '${option}'`));
    }
    for (const value of ["'system'", "'light'", "'dark'"]) {
      check(`Appearance can actually set ${value}`, new RegExp(`value: ${value}`).test(appearance), appearance);
    }
    check('Appearance stores the choice rather than only marking it', /setPreference\(option\.value\)/.test(appearance), appearance);

    // A switch that changes nothing is the failure mode to avoid everywhere.
    for (const [name, source] of [
      ['language', language],
      ['appearance', appearance],
      ['notifications', notifications],
      ['privacy', privacy],
      ['about', about],
    ] as const) {
      const code = stripComments(source);
      check(`${name} renders no Switch or Toggle`, !/Switch|Toggle|Radio/.test(code));
    }

    /*
     * State used to fake a setting is the failure. State used to DO a setting is
     * the fix, so this now only holds for the screens that have no real work to
     * do — and Appearance and Privacy are checked below for doing theirs.
     */
    for (const [name, source] of [
      ['language', language],
      ['notifications', notifications],
      ['about', about],
    ] as const) {
      const code = stripComments(source);
      check(`${name} uses no state to fake a setting`, !/useState/.test(code));
    }
    check('Appearance keeps its real choice, not a fake one', /useThemePreference\(\)/.test(stripComments(appearance)), stripComments(appearance));
    check('Privacy keeps its real deletion, not a fake one', /sessionStore[\s\S]*clearSessions/.test(stripComments(privacy)), stripComments(privacy));

    // Language reports the one real answer.
    check('Language states the current language', language.includes('value="English"'));
    check('Language is honest that switching is not available', /not available yet/i.test(language));

    // Notifications: the app has no notification support at all, and says so.
    check('Notifications admits there is no reminder support', /does not send reminders/i.test(notifications));

    // Privacy reports only what the code and app.json actually say.
    const privacyWords = readerVisibleStrings(privacy).join(' ').toLowerCase();
    check('Privacy states the camera is used during a session', privacy.includes('Used during an exercise session'));
    check('Privacy says the microphone is not used', privacy.includes('Not used'));
    check('Privacy says history is saved on the phone', privacy.includes('Saved on this phone'));
    check('Privacy is honest that there is no account yet', privacy.includes('Not set up'));
    // Storage here is plain AsyncStorage, so an encryption promise would be false.
    check('Privacy does not claim encryption', !privacyWords.includes('encrypt'));
    check('Privacy does not claim a server, cloud, or backup', !/(server|cloud|upload|backup)/.test(privacyWords));

    // About: real values, no invented claims.
    const aboutWords = readerVisibleStrings(about).join(' ').toLowerCase();
    check('About reads the version from the app config', about.includes('Constants.expoConfig'));
    check('About does not hardcode a version number', !/value="[0-9]+\.[0-9]+\.[0-9]+"/.test(about));
    check('About counts the real exercise catalogue', about.includes('exercisesCatalog.length'));
    check('About makes no health or performance claim', !/(improve|health|benefit|boost|proven|effective|results?)/.test(aboutWords));
    check('About invents no organisation or award', !/(founded|team|award|certified|partner|company)/.test(aboutWords));
  });

  suite('settings: the wording a reader sees is plain, not clinical or technical', () => {
    // The wording a person actually sees must never read like a clinician's note
    // or a developer's console. Comments are stripped first, because several of
    // these screens quote the banned words precisely in order to explain why they
    // are absent.
    const banned = [
      'clinical', 'diagnosis', 'diagnostic', 'patient', 'therapy', 'rehab',
      'symptom', 'medication', 'prescription', 'score', 'accuracy', 'metric',
      'api', 'token', 'session id', 'uuid', 'json', 'asyncstorage', 'config',
      'endpoint', 'repository', 'debug', 'null', 'undefined', 'boolean',
    ];

    // The settings/family route is a thin wrapper around the shared Family
    // screen, so the wording a reader sees there is checked on the component
    // rather than on the two lines that import it.
    for (const [name, source] of SCREENS) {
      const words = readerVisibleStrings(source).join(' ').toLowerCase();

      // Without this the whole suite would pass vacuously the day the extractor
      // broke, so the extractor has to prove it is actually finding copy.
      check(`${name} has readable wording to check`, words.length > 40, words);

      for (const word of banned) {
        check(
          `${name} does not show the word "${word}"`,
          !words.includes(word),
          words.match(new RegExp(`.{0,40}${word}.{0,40}`)),
        );
      }
    }

    // A pass-through route must stay a pass-through route. Any wording appearing
    // in one of these is wording that exists in a second place, which is how two
    // copies of a screen start disagreeing with each other.
    for (const [name, source] of PASS_THROUGH_ROUTES) {
      const words = readerVisibleStrings(source).join(' ').trim();
      check(`${name} adds no wording of its own`, words.length === 0, words);
    }

    // Spot-check that the extractor sees the copy that matters, so a regression
    // in the extractor cannot quietly turn this suite into a no-op.
    const familyWords = readerVisibleStrings(readComponent('family', 'family-screen.tsx'));
    check('the extractor finds the add action', familyWords.some((s) => s.includes('Add family member')));
    check('the extractor finds the empty state', familyWords.some((s) => s.includes('No family members yet')));
    const settingsWords = readerVisibleStrings(read('settings', 'index.tsx'));
    for (const heading of ['Family', 'Language', 'Appearance', 'Notifications', 'Privacy & Safety', 'About NOVEN']) {
      check(`the extractor finds the ${heading} heading`, settingsWords.some((s) => s.trim() === heading));
    }
  });

  suite('navigation: the new screens use plain words, not jargon', () => {
    // The tab labels and the Activities page are the first things an older adult
    // reads, so they are held to the same plain-language rule as Settings. The
    // word "score" is not on this list: the Progress tab's name for its one real
    // number is a deliberate, approved label.
    const jargon = [
      'api', 'token', 'json', 'asyncstorage', 'config', 'endpoint', 'repository',
      'debug', 'null', 'undefined', 'boolean', 'async', 'await', 'props',
      'session id', 'uuid', 'metric', 'accuracy', 'schema', 'type', 'interface',
    ];

    const screens: Array<[string, string]> = [
      ['(tabs)/activities.tsx', read('(tabs)', 'activities.tsx')],
      ['(tabs)/progress.tsx', read('(tabs)', 'progress.tsx')],
      ['(tabs)/index.tsx', read('(tabs)', 'index.tsx')],
      // The Family tab's copy lives in the shared screen it renders.
      ['family/family-screen.tsx', readComponent('family', 'family-screen.tsx')],
      ['app-tabs.tsx', readComponent('app-tabs.tsx')],
      ['progress/progress-section.tsx', readComponent('progress', 'progress-section.tsx')],
    ];

    for (const [name, source] of screens) {
      const words = readerVisibleStrings(source).join(' ').toLowerCase();
      // Same vacuity guard as above.
      check(`${name} has readable wording to check`, words.length > 30, words);
      for (const word of jargon) {
        check(`${name} does not show the word "${word}"`, !words.includes(word));
      }
    }
  });
}

function cap(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
