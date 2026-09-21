import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ScoreCardProps = {
  /** Numeric score out of `max`. Omit to render an empty state. */
  score?: number;
  /** Denominator used for the progress bar. Defaults to `100`. */
  max?: number;
  label?: string;
  hint?: string;
  /** Charcoal card in light mode / keeps warm-white text. */
  variant?: 'surface' | 'inverse';
  /** Color used for the number and the progress fill. */
  emphasis?: 'accent' | 'sage';
  /** Optional element rendered next to the label. */
  trailing?: ReactNode;
};

const INVERSE_NUMBER = {
  accent: '#F58A5F',
  sage: '#86AC9D',
} as const;

export function ScoreCard({
  score,
  max = 100,
  label,
  hint,
  variant = 'inverse',
  emphasis = 'sage',
  trailing,
}: ScoreCardProps) {
  const theme = useTheme();
  const inverse = variant === 'inverse';

  const hasScore = typeof score === 'number';
  const pct = hasScore ? Math.max(0, Math.min(100, (score / max) * 100)) : 0;

  const cardBackground = inverse ? theme.surfaceInverse : theme.backgroundElement;
  const numberColor = inverse ? INVERSE_NUMBER[emphasis] : theme.accentSecondary;
  const titleColor = inverse ? '#FAF9F6' : theme.heading;
  const secondaryColor = inverse ? 'rgba(250, 249, 246, 0.7)' : theme.textSecondary;
  const trackColor = inverse ? 'rgba(250, 249, 246, 0.16)' : theme.backgroundSelected;

  return (
    <View style={[styles.card, { backgroundColor: cardBackground }]}>
      <View style={styles.topRow}>
        <Text style={[styles.score, { color: hasScore ? numberColor : secondaryColor }]}>
          {hasScore ? score : '—'}
        </Text>
        <View style={styles.copy}>
          {label ? <Text style={[styles.label, { color: titleColor }]}>{label}</Text> : null}
          {hint ? (
            <Text style={[styles.hint, { color: secondaryColor }]}>{hint}</Text>
          ) : null}
        </View>
        {trailing}
      </View>

      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: numberColor, width: hasScore ? `${pct}%` : '0%' },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.six,
    borderRadius: Radius.card,
    gap: Spacing.five,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.five,
  },
  score: {
    ...Type.headingLarge,
    fontSize: 44,
    lineHeight: 48,
    fontWeight: '800',
  },
  copy: {
    flex: 1,
    gap: Spacing.half,
  },
  label: {
    ...Type.label,
    fontSize: 16,
    lineHeight: 22,
  },
  hint: Type.small,
  track: {
    height: 8,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
});