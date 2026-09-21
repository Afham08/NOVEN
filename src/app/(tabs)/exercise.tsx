import { Link } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function ExerciseScreen() {
  return (
    <PlaceholderScreen title="Exercise" description="Exercise flow placeholder routes.">
      <ThemedView type="backgroundElement" style={styles.links}>
        <Link href="/exercise/demo" asChild>
          <Pressable>
            <ThemedText type="linkPrimary">Open exercise detail (exercise/demo)</ThemedText>
          </Pressable>
        </Link>
        <Link href="/exercise/session" asChild>
          <Pressable>
            <ThemedText type="linkPrimary">Start session (exercise/session)</ThemedText>
          </Pressable>
        </Link>
        <Link href="/exercise/result" asChild>
          <Pressable>
            <ThemedText type="linkPrimary">View result (exercise/result)</ThemedText>
          </Pressable>
        </Link>
      </ThemedView>
    </PlaceholderScreen>
  );
}

const styles = StyleSheet.create({
  links: {
    gap: Spacing.three,
    alignSelf: 'stretch',
    padding: Spacing.four,
    borderRadius: Spacing.four,
    alignItems: 'center',
  },
});