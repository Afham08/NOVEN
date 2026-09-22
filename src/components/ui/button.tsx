import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
export type ButtonSize = 'large' | 'medium';

export type ButtonProps = PressableProps & {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Optional leading element (e.g. an icon) shown before the label. */
  leading?: ReactNode;
  loading?: boolean;
  /** Stretch to full available width. Defaults to `true`. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

const SIZE_STYLES = {
  large: { minHeight: 60, paddingHorizontal: Spacing.six, gap: Spacing.two },
  medium: { minHeight: 52, paddingHorizontal: Spacing.five, gap: Spacing.two },
} as const;

const LABEL_STYLES = {
  large: { fontSize: 19, lineHeight: 26 },
  medium: { fontSize: 17, lineHeight: 24 },
} as const;

export function Button({
  title,
  variant = 'primary',
  size = 'large',
  leading,
  loading = false,
  fullWidth = true,
  disabled,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();

  const filled = variant === 'primary' || variant === 'secondary';
  const background = variant === 'primary' ? theme.accent : theme.accentSecondary;
  const foreground = filled ? theme.onAccent : variant === 'outline' ? theme.accent : theme.accentSecondary;
  const border = variant === 'outline' ? { borderWidth: 1.5, borderColor: theme.accent } : undefined;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled ?? loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        border,
        SIZE_STYLES[size],
        style,
      ]}
      {...rest}>
      {loading ? (
        <ActivityIndicator color={foreground} />
      ) : (
        leading
      )}
      <Text style={[styles.label, { color: foreground }, LABEL_STYLES[size]]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.button,
  },
  fullWidth: {
    width: '100%',
  },
  label: {
    fontFamily: Type.label.fontFamily,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});