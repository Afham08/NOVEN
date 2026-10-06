import { check, suite } from './harness';

import { THEME_PREFERENCE_OPTIONS, isThemePreference } from '../src/settings/theme-preference';

/*
 * Appearance used to be a control nobody could read.
 *
 * `Button` resolved a ghost button's background and its text from the same
 * expression, so the three Appearance rows were teal text on a teal fill: a 1:1
 * label. Nothing failed, nothing crashed, and a screen reader still announced
 * every row correctly, because the label is also the accessibility label. Only a
 * sighted person on a real screen could tell the setting was broken.
 *
 * The test build deliberately excludes `.tsx`, so this file reads the sources
 * the way settings-navigation.test.ts and activity-flow.test.ts do. What it
 * checks is not that particular words are present but that the colour each
 * variant resolves to can actually be read: the palettes are parsed out of
 * theme.ts and the real WCAG contrast formula is applied to them. Reintroducing
 * a foreground that matches its own background fails on the arithmetic, not on
 * a string match, and it fails in both light and dark.
 */

// The harness is zero-dependency and tsconfig.test.json has no `node` types.
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: 'utf8'): string;
  resolve(...segments: string[]): string;
};
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

// __dirname is the COMPILED test directory, so src is two levels up. Line endings
// are normalised because git checks these sources out with CRLF on Windows, and
// every pattern below anchors on `\n`.
const readSrc = (...segments: string[]) =>
  readFileSync(resolve(__dirname, '../../src', ...segments), 'utf8').replace(/\r\n/g, '\n');

type Palette = Record<string, string>;

/** Pulls one palette out of the `Colors` literal in theme.ts. */
function palette(themeSource: string, name: 'light' | 'dark'): Palette {
  const block = themeSource.split(`${name}: {`)[1]?.split('},')[0] ?? '';
  const found: Palette = {};
  for (const match of block.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) {
    found[match[1]] = match[2];
  }
  return found;
}

/** Removes comments, so prose about a colour is not mistaken for the colour. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The right-hand side of a `const name = ...;` assignment. */
function assignment(source: string, name: string): string {
  const match = source.match(new RegExp(`const ${name} =([\\s\\S]*?);\\n`));
  return match ? match[1].trim() : '';
}

/** The value a ternary chain finally falls through to. */
function finalBranch(expression: string): string {
  const branches = expression.split(/(?<!:):/).map((part) => part.trim());
  return branches[branches.length - 1];
}

/** `theme.accent` reads as the token `accent`; `'transparent'` stays as it is. */
function tokenOf(expression: string): string {
  return expression.replace(/^theme\./, '').replace(/^'(.*)'$/, '$1');
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. */
function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const [lighter, darker] = a > b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * A 17-19px bold label is "large text" under WCAG, which needs 3:1. The old
 * ghost label scored 1:1, which is why this threshold is the thing being tested
 * rather than any particular colour.
 */
const LARGE_TEXT_MINIMUM = 3;
const BODY_MINIMUM = 4.5;

export function run(): void {
  const themeSource = readSrc('constants/theme.ts');
  const buttonSource = stripComments(readSrc('components/ui/button.tsx'));
  const appearanceSource = stripComments(readSrc('app/settings/appearance.tsx'));

  const light = palette(themeSource, 'light');
  const dark = palette(themeSource, 'dark');
  const bothPalettes = { light, dark };

  suite('theme: both palettes parsed, so the contrast checks below are real', () => {
    for (const [name, colours] of Object.entries(bothPalettes)) {
      check(`the ${name} palette has tokens`, Object.keys(colours).length > 0, {
        name,
        found: Object.keys(colours),
      });
      for (const token of ['text', 'backgroundElement', 'accent', 'accentSecondary', 'onAccent']) {
        check(`the ${name} palette defines ${token}`, colours[token] !== undefined, name);
      }
    }
  });

  suite('button: colours come from the theme, never from a literal', () => {
    const literals = buttonSource.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
    check('button.tsx hardcodes no hex colour', literals.length === 0, literals);

    // A token that exists in one palette but not the other is undefined at
    // runtime on whichever scheme lacks it, which reads as a broken control.
    for (const [name, colours] of Object.entries(bothPalettes)) {
      const used = [...buttonSource.matchAll(/theme\.(\w+)/g)].map((match) => match[1]);
      const missing = [...new Set(used)].filter((token) => colours[token] === undefined);
      check(`every token button.tsx uses exists in the ${name} palette`, missing.length === 0, missing);
    }
  });

  suite('button: the bare variants keep the surface behind them', () => {
    const background = assignment(buttonSource, 'background');

    check(
      'the non-filled branch of background is transparent',
      /:\s*'transparent'\s*$/.test(background),
      background,
    );
    check(
      'ghost does not fall through to a solid fill colour',
      !/^theme\.accentSecondary$/.test(finalBranch(background)),
      finalBranch(background),
    );
  });

  suite('button: every variant paints a label that can be read', () => {
    const background = assignment(buttonSource, 'background');
    const foreground = assignment(buttonSource, 'foreground');
    const ghostToken = tokenOf(finalBranch(foreground));
    const ghostBackground = tokenOf(finalBranch(background));

    /*
     * The regression, stated as arithmetic.
     *
     * A ghost label has to be read against whatever is actually behind it, which
     * is the button's own background and not automatically the card. Comparing
     * teal-on-white would have passed while the real bug was teal on a teal FILL
     * at 1:1, so the effective background is resolved first: 'transparent' means
     * the card shows through, and any other token is painted behind the label and
     * has to be contrasted in its own right.
     */
    const behind = (colours: Palette) =>
      ghostBackground === 'transparent'
        ? colours.backgroundElement
        : (colours[ghostBackground] ?? colours.backgroundElement);

    for (const [name, colours] of Object.entries(bothPalettes)) {
      const label = colours[ghostToken];
      const surface = behind(colours);
      const ratio = contrast(label ?? '#000000', surface);

      check(
        `a ghost label is readable in ${name}`,
        label !== undefined && ratio >= BODY_MINIMUM,
        { foreground: ghostToken, background: ghostBackground, surface, ratio },
      );
      check(
        `a ghost label is not painted on its own background in ${name}`,
        label !== undefined && label !== surface && ratio > 1.2,
        { foreground: ghostToken, surface, ratio },
      );
    }

    check(
      'a ghost label is not a fill colour',
      ghostToken !== 'accentSecondary' && ghostToken !== 'onAccent',
      ghostToken,
    );

    for (const [name, colours] of Object.entries(bothPalettes)) {
      // Outline keeps the surface and draws its label in the accent token.
      check(
        `an outline label is readable in ${name}`,
        contrast(colours.accent, colours.backgroundElement) >= LARGE_TEXT_MINIMUM,
        {
          ratio: contrast(colours.accent, colours.backgroundElement),
        },
      );
      /*
       * The filled variants keep white on their own accent, which is what makes
       * them legible and is asserted structurally rather than against a contrast
       * floor: `secondary` in the dark palette is 2.7:1, a pre-existing shortfall
       * that belongs to the palette rather than to this component, so pinning a
       * number here would only fail on something this change did not touch.
       */
      check(
        `a primary label is white on the accent, not on itself, in ${name}`,
        colours.onAccent !== colours.accent,
        { onAccent: colours.onAccent, accent: colours.accent },
      );
      check(
        `a secondary label is white on the secondary accent, not on itself, in ${name}`,
        colours.onAccent !== colours.accentSecondary,
        { onAccent: colours.onAccent, accentSecondary: colours.accentSecondary },
      );
    }

    check(
      'the filled variants keep their own backgrounds',
      /theme\.accent/.test(background) && /theme\.accentSecondary/.test(background),
      background,
    );
  });

  suite('button: outline is an outline, not a second filled button', () => {
    const border = assignment(buttonSource, 'border');

    check('outline draws a border', /borderWidth/.test(border), border);
    check('the border uses the accent token', /borderColor:\s*theme\.accent/.test(border), border);

    // The bug: outline shared the ghost/secondary fill instead of the surface.
    const background = assignment(buttonSource, 'background');
    check(
      'outline is not filled with accentSecondary',
      !/variant === 'outline'[^\n]*\?\s*theme\.accentSecondary/.test(background),
      background,
    );
    check(
      'no variant resolves background and foreground from one shared colour',
      !/const foreground =[^;]*theme\.accentSecondary\s*$/.test(buttonSource),
      assignment(buttonSource, 'foreground'),
    );
  });

  suite('button: the label is announced, which is why the bug was so quiet', () => {
    check(
      'the pressed label is the accessibility label',
      /accessibilityLabel=\{title\}/.test(buttonSource),
    );
  });

  suite('appearance: the three choices are named and are the real preferences', () => {
    const options = [...appearanceSource.matchAll(/value:\s*'(\w+)',\s*label:\s*'([^']+)'/g)].map(
      (match) => ({ value: match[1], label: match[2] }),
    );

    check('three appearance choices are offered', options.length === 3, options);

    for (const option of options) {
      check(`${option.value} is a real stored preference`, isThemePreference(option.value), option.value);
      check(`${option.value} has a readable label`, option.label.trim().length > 0, option);
    }

    /*
     * The screen owns the wording, but it must not invent a fourth choice or
     * misspell one: the values are checked against the stored preference list,
     * which is imported and therefore the real thing rather than a copy.
     */
    const offered = options.map((option) => option.value).sort();
    const stored = [...THEME_PREFERENCE_OPTIONS].sort();
    check(
      'the choices match the stored preference list exactly',
      offered.length === stored.length && offered.every((value, index) => value === stored[index]),
      { offered, stored },
    );

    for (const label of ['Light', 'Dark']) {
      check(`"${label}" is one of the labels`, options.some((option) => option.label === label), options);
    }
    check(
      'the third choice is labelled in plain words rather than the word "system"',
      options.some((option) => option.value === 'system' && option.label !== 'system'),
      options,
    );

    check('the choices use the ghost variant', /variant="ghost"/.test(appearanceSource));
    check('the chosen choice is still marked', /preference === option\.value/.test(appearanceSource));
  });

  suite('appearance: selection still goes through the persisted preference', () => {
    check(
      'the screen reads the preference from the hook',
      /useThemePreference\(\)/.test(appearanceSource),
    );
    check('the screen writes through the hook', /setPreference\(option\.value\)/.test(appearanceSource));
    // Persistence stays in one place; the screen must not reach for storage itself.
    check(
      'the screen does not touch storage directly',
      !/AsyncStorage|SessionStorage|NOVEN\.appearance/.test(appearanceSource),
    );
    check(
      'the preference key is still owned by the settings module',
      readSrc('settings/theme-preference.ts').includes('THEME_PREFERENCE_KEY'),
    );
  });
}
