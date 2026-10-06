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
  /**
   * Optional trailing element shown after the label — a tick, a value, a chevron.
   * Used by selection rows, where the mark of "this one is chosen" belongs on the
   * same target as the choice rather than on a smaller thing beside it.
   */
  right?: ReactNode;
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
  right,
  loading = false,
  fullWidth = true,
  disabled,
  style,
  onPress,
  ...rest
}: ButtonProps) {
  const theme = useTheme();

  const filled = variant === 'primary' || variant === 'secondary';

  /*
   * A filled control is the thing being looked at, so it carries its own
   * background. `ghost` and `outline` are not that: they sit on a card and let
   * the card's own surface show through, which is why they take no colour at
   * all rather than a pale one.
   *
   * This is what was wrong before, and it was invisible rather than ugly. Both
   * bare variants fell through to `theme.accentSecondary` for their background
   * AND their text, so a ghost label was painted teal on teal — a 1:1 label,
   * present in the tree and unreadable on screen. It survived review because
   * `accessibilityLabel` is still the title, so a screen reader read the row
   * perfectly while a sighted person saw a blank bar.
   *
   * The two treatments now differ in exactly the way their names promise: ghost
   * is a bare label in the ordinary text colour, and outline additionally draws
   * a border so it still reads as a control when it is not filled.
   */
  const background = filled
    ? variant === 'primary'
      ? theme.accent
      : theme.accentSecondary
    : 'transparent';
  const foreground = filled
    ? theme.onAccent
    : variant === 'outline'
      ? theme.accent
      : theme.text;
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
          <>
            {leading}
            <Text style={[styles.label, { color: foreground }, LABEL_STYLES[size]]}>{title}</Text>
            {right}
          </>
        )}
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