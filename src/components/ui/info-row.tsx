import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type InfoRowProps = {
  label: string;
  value: string;
  /** Renders the value in the brand accent color. */
  emphasize?: boolean;
  /**
   * Stack the value underneath the label instead of setting them side by side.
   *
   * Side by side, the two texts share one row, so a long label and a large
   * accessibility font size meet in the middle and can push the value off the
   * end. Stacking removes the collision entirely, and a screen reader then reads
   * the label and its value in the order a person reads them.
   */
  stacked?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function InfoRow({
  label,
  value,
  emphasize = false,
  stacked = false,
  style,
}: InfoRowProps) {
  const theme = useTheme();
  const valueColor = emphasize ? theme.accent : theme.heading;

  if (stacked) {
    return (
      <View style={[styles.stackedRow, style]}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
        <Text style={[styles.stackedValue, { color: valueColor }]}>{value}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, style]}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.four,
  },
  stackedRow: {
    gap: Spacing.one,
  },
  label: {
    ...Type.label,
    fontSize: 17,
    lineHeight: 24,
    // Lets a long label wrap instead of shoving the value out of the row.
    flexShrink: 1,
  },
  value: {
    ...Type.label,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'right',
    flexShrink: 1,
  },
  stackedValue: {
    ...Type.subheading,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});