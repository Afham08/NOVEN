import {
  Tabs,
  TabList,
  TabTrigger,
  TabSlot,
  TabTriggerSlotProps,
  TabListProps,
} from 'expo-router/ui';
import { Pressable, View, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { MaxContentWidth, Spacing, Type } from '@/constants/theme';

/**
 * The web tab bar, matching the native one exactly: the same four primary
 * destinations in the same order.
 *
 * This is a separate file for the web platform, so the native bar and this one
 * can drift apart unless both are changed together. Every destination in
 * `app-tabs.tsx` belongs here too, and nothing more.
 */
export default function AppTabs() {
  return (
    <Tabs>
      <TabSlot style={{ height: '100%' }} />
      <TabList asChild>
        <CustomTabList>
          <TabTrigger name="index" href="/" asChild>
            <TabButton>Home</TabButton>
          </TabTrigger>
          <TabTrigger name="activities" href="/activities" asChild>
            <TabButton>Activities</TabButton>
          </TabTrigger>
          <TabTrigger name="progress" href="/progress" asChild>
            <TabButton>Progress</TabButton>
          </TabTrigger>
          <TabTrigger name="family" href="/family" asChild>
            <TabButton>Family</TabButton>
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

/**
 * A single tab. The label is 16px rather than the 14px `Type.small` it used to
 * be, and the row keeps a 48px minimum height, so the bar meets the same touch
 * target and legibility bar as the rest of the app instead of being the one
 * place with small text on it.
 */
export function TabButton({ children, isFocused, ...props }: TabTriggerSlotProps) {
  return (
    <Pressable {...props} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView
        type={isFocused ? 'backgroundSelected' : 'backgroundElement'}
        style={styles.tabButtonView}>
        {/*
          The active tab is marked by the filled background above and by the
          darker, bolder text here, so the current page is obvious without
          relying on colour alone.
        */}
        <ThemedText type="default" themeColor={isFocused ? 'text' : 'textSecondary'} style={styles.tabLabel}>
          {children}
        </ThemedText>
      </ThemedView>
    </Pressable>
  );
}

export function CustomTabList(props: TabListProps) {
  return (
    <View {...props} style={styles.tabListContainer}>
      <ThemedView type="backgroundElement" style={styles.innerContainer}>
        <ThemedText type="smallBold" style={styles.brandText}>
          NOVEN
        </ThemedText>

        {props.children}
      </ThemedView>
    </View>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    width: '100%',
    padding: Spacing.three,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  innerContainer: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
    borderRadius: Spacing.five,
    flexDirection: 'row',
    alignItems: 'center',
    flexGrow: 1,
    gap: Spacing.two,
    maxWidth: MaxContentWidth,
  },
  brandText: {
    marginRight: 'auto',
  },
  pressed: {
    opacity: 0.7,
  },
  tabButtonView: {
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.three,
  },
  tabLabel: {
    // The emphasis of the active tab, over the 16px body size `default` already
    // sets. Written after the spread so it wins, and left as a plain value
    // rather than a token so the browser's own text-size setting still scales it.
    ...Type.bodyEmphasis,
    fontSize: 16,
    lineHeight: 22,
  },
});
