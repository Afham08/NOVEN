import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export type ScreenProps = PropsWithChildren<{
  contentStyle?: StyleProp<ViewStyle>;
}>;

/** Consistent scrollable screen wrapper used across NOVEN content screens. */
export function Screen({ children, contentStyle }: ScreenProps) {
  /*
   * Android 15+ draws the app edge-to-edge, so the window extends underneath the
   * system navigation strip. Without the bottom inset here, the last row of a
   * scrolled screen — often the primary button, as on the Result screen — sits
   * inside the gesture zone and is hard or impossible to tap. The tab bar on tab
   * screens already clears the strip on its own; the extra padding there only
   * leaves a little more breathing room at the end of the scroll.
   */
  const bottomInset = useSafeAreaInsets().bottom;

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Spacing.six + bottomInset },
          contentStyle,
        ]}
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