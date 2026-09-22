import { StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type StatusChipTone = 'ready' | 'accent' | 'sage';

export type StatusChipProps = {
  label: string;
  tone?: StatusChipTone;
};

const DOT_COLOR: Record<StatusChipTone, string> = {
  ready: '#527568',
  accent: '#F15A24',
  sage: '#7FA497',
};

export function StatusChip({ label, tone = 'ready' }: StatusChipProps) {
  const theme = useTheme();

  return (
    <View style={[styles.chip, { backgroundColor: theme.sageSoft }]}>
      <View style={[styles.dot, { backgroundColor: DOT_COLOR[tone] }]} />
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: Radius.pill,
  },
  label: {
    ...Type.caption,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
});