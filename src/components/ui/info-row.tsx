import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type InfoRowProps = {
  label: string;
  value: string;
  /** Renders the value in the brand accent color. */
  emphasize?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function InfoRow({ label, value, emphasize = false, style }: InfoRowProps) {
  const theme = useTheme();

  return (
    <View style={[styles.row, style]}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <Text style={[styles.value, { color: emphasize ? theme.accent : theme.heading }]}>
        {value}
      </Text>
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
  label: {
    ...Type.label,
    fontSize: 17,
    lineHeight: 24,
  },
  value: {
    ...Type.label,
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '700',
    textAlign: 'right',
  },
});