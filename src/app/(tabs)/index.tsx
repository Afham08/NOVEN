import { Link } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { PlaceholderScreen } from '@/components/placeholder-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

export default function HomeScreen() {
  return (
    <PlaceholderScreen title="Home" description="Your NOVEN home screen.">
      <ThemedView type="backgroundElement" style={styles.links}>
        <Link href="/settings" asChild>
          <Pressable>
            <ThemedText type="linkPrimary">Open settings</ThemedText>
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