import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing } from '@/constants/theme';
import { ThemedView } from '@/components/themed-view';

const exerciseLinks = [
  { title: 'Open exercise detail', route: '/exercise/demo' as const, variant: 'primary' as const },
  { title: 'Start a session', route: '/exercise/session' as const, variant: 'secondary' as const },
  { title: 'View result', route: '/exercise/result' as const, variant: 'outline' as const },
];

export default function ExerciseScreen() {
  const router = useRouter();

  return (
    <ThemedView style={styles.screen}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}>
        <Header
          eyebrow="Move"
          title="Exercise"
          subtitle="The exercise flow opens from here."
        />

        <SectionHeader accent title="Route preview" subtitle="Placeholder navigation for the exercise journey." />

        <Card variant="surface" gap={Spacing.three}>
          {exerciseLinks.map((link) => (
            <Button
              key={link.route}
              variant={link.variant}
              title={link.title}
              onPress={() => router.push(link.route)}
            />
          ))}
        </Card>
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