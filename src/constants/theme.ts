/**
 * NOVEN design tokens.
 *
 * Direction: premium, warm, calm, human-first, elder-friendly, wellness-oriented.
 * Deliberately not clinical, not neon, not cyberpunk. No purple identity.
 *
 * Colors follow the brand palette:
 * - Warm white  #FAF9F6 (app background)
 * - Charcoal    #202522 (primary text / inverse surfaces)
 * - Black ink   #111111 (headings)
 * - Orange      #F15A24 (primary accent)
 * - Teal/sage   #527568 (secondary accent)
 * - Gray        #68716D (secondary text)
 * - Pale sage   #E7EFEB (soft surfaces)
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    background: '#FAF9F6',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#F1EFEA',
    text: '#202522',
    heading: '#111111',
    textSecondary: '#68716D',
    textDisabled: '#9AA39E',
    accent: '#F15A24',
    accentSoft: '#FDE9E2',
    accentSecondary: '#527568',
    accentSecondarySoft: '#E4ECE7',
    sageSoft: '#E7EFEB',
    onAccent: '#FFFFFF',
    border: '#E4E1DB',
    surfaceInverse: '#202522',
  },
  dark: {
    background: '#141613',
    backgroundElement: '#202522',
    backgroundSelected: '#2A2F2C',
    text: '#ECEAE4',
    heading: '#FAF9F6',
    textSecondary: '#A4ACA7',
    textDisabled: '#6F7772',
    accent: '#F15A24',
    accentSoft: '#3A2118',
    accentSecondary: '#7FA497',
    accentSecondarySoft: '#223630',
    sageSoft: '#1D2622',
    onAccent: '#FFFFFF',
    border: '#30342F',
    surfaceInverse: '#202522',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Platform font choices. Uses the system font stacks exposed by the Expo font
 * system per platform (see web font variables in `src/global.css`).
 */
export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

/**
 * Typography scale. Body copy is sized for comfortable reading (16–17px),
 * headings are strong but intentionally not oversized.
 */
export const Type = {
  headingLarge: { fontFamily: Fonts.sans, fontSize: 32, lineHeight: 40, fontWeight: '700' },
  heading: { fontFamily: Fonts.sans, fontSize: 24, lineHeight: 32, fontWeight: '700' },
  subheading: { fontFamily: Fonts.sans, fontSize: 20, lineHeight: 28, fontWeight: '600' },
  body: { fontFamily: Fonts.sans, fontSize: 17, lineHeight: 26, fontWeight: '400' },
  bodyEmphasis: { fontFamily: Fonts.sans, fontSize: 17, lineHeight: 26, fontWeight: '600' },
  label: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  small: { fontFamily: Fonts.sans, fontSize: 14, lineHeight: 21, fontWeight: '400' },
  caption: { fontFamily: Fonts.sans, fontSize: 13, lineHeight: 19, fontWeight: '500' },
} as const;

export type TypeToken = keyof typeof Type;

/**
 * Consistent 4/8-based spacing scale.
 */
export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 20,
  six: 24,
  seven: 32,
  eight: 48,
} as const;

/**
 * Corner radius scale. Privileges rounded-but-not-pill shapes.
 */
export const Radius = {
  small: 8,
  control: 12,
  chip: 12,
  button: 16,
  card: 20,
  pill: 999,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;