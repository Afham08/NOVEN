import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type ScreenProps = PropsWithChildren<{
  contentStyle?: StyleProp<ViewStyle>;
}>;

/** Consistent scrollable screen wrapper used across NOVEN content screens. */
export function Screen({ children, contentStyle }: ScreenProps) {
  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
    gap: Spacing.six,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
});