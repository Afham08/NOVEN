import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ActivityCardProps = PressableProps & {
  title: string;
  description?: string;
  /** Element rendered inside the tinted icon plate (e.g. an expo-symbols icon). */
  icon?: ReactNode;
  /** Tint applied to the icon plate. */
  tint?: 'accent' | 'sage';
  /** Short right-aligned label (e.g. a time or count). */
  rightLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function ActivityCard({
  title,
  description,
  icon,
  tint = 'accent',
  rightLabel,
  disabled,
  style,
  ...rest
}: ActivityCardProps) {
  const theme = useTheme();
  const plateBackground = tint === 'accent' ? theme.accentSoft : theme.sageSoft;

  return (
    <Pressable
      accessibilityRole={disabled ? undefined : 'button'}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
        pressed && !disabled && styles.pressed,
        style,
      ]}
      {...rest}>
      {icon ? <View style={[styles.iconPlate, { backgroundColor: plateBackground }]}>{icon}</View> : null}
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.heading }]}>{title}</Text>
        {description ? (
          <Text style={[styles.description, { color: theme.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
      {rightLabel ? (
        <Text style={[styles.rightLabel, { color: theme.textSecondary }]}>{rightLabel}</Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
    padding: Spacing.four,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  iconPlate: {
    width: 52,
    height: 52,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    gap: Spacing.half,
  },
  title: Type.label,
  description: Type.small,
  rightLabel: {
    ...Type.caption,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.82,
  },
});