import { StyleSheet, View, type ViewProps } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type CardVariant = 'surface' | 'sage' | 'tint' | 'inverse';
export type CardPadding = 'none' | 'small' | 'medium' | 'large';

export type CardProps = ViewProps & {
  /** Surface treatment. */
  variant?: CardVariant;
  /** Inner padding. Defaults to `medium`. */
  padding?: CardPadding;
  /** Gap applied between children inside the card. */
  gap?: number;
  /** Draw a hairline border (surface cards only). */
  bordered?: boolean;
};

const PADDING: Record<CardPadding, number | undefined> = {
  none: undefined,
  small: Spacing.three,
  medium: Spacing.four,
  large: Spacing.six,
};

export function Card({
  variant = 'surface',
  padding = 'medium',
  gap,
  bordered = true,
  style,
  children,
  ...rest
}: CardProps) {
  const theme = useTheme();
  const background = {
    surface: theme.backgroundElement,
    sage: theme.sageSoft,
    tint: theme.accentSoft,
    inverse: theme.surfaceInverse,
  }[variant];

  const paddingValue = PADDING[padding];
  const borderColor = bordered && variant === 'surface' ? theme.border : 'transparent';

  return (
    <View
      style={[
        styles.base,
        { backgroundColor: background, borderColor, gap },
        paddingValue != null && { padding: paddingValue },
        style,
      ]}
      {...rest}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    shadowColor: '#202522',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});