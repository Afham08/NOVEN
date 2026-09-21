import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type SectionHeaderProps = {
  title: string;
  subtitle?: string;
  /** Element rendered on the right side (e.g. a "See all" link). */
  right?: ReactNode;
  /** Shows a small brand accent bar in front of the title. */
  accent?: boolean;
};

export function SectionHeader({ title, subtitle, right, accent = false }: SectionHeaderProps) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.titleGroup}>
          {accent && <View style={[styles.accent, { backgroundColor: theme.accent }]} />}
          <Text style={[styles.title, { color: theme.heading }]}>{title}</Text>
        </View>
        {right}
      </View>
      {subtitle ? (
        <Text
          style={[
            styles.subtitle,
            accent && styles.subtitleIndent,
            { color: theme.textSecondary },
          ]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  accent: {
    width: 4,
    height: 20,
    borderRadius: Radius.small / 2,
  },
  title: Type.heading,
  subtitle: Type.small,
  subtitleIndent: {
    paddingLeft: Spacing.three + Spacing.two,
  },
});