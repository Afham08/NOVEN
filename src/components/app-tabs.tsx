import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="house" md="home" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="exercise">
        <NativeTabs.Trigger.Label>Exercise</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="figure.run" md="directions_run" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="yoga">
        <NativeTabs.Trigger.Label>Yoga</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="figure.yoga" md="self_improvement" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="meditation">
        <NativeTabs.Trigger.Label>Meditation</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="brain.head.profile" md="spa" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="wellness">
        <NativeTabs.Trigger.Label>Wellness</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="heart" md="favorite" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="family">
        <NativeTabs.Trigger.Label>Family</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.2" md="family_restroom" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}