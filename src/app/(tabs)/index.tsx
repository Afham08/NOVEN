import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { ActivityCard } from '@/components/cards/activity-card';
import { ScoreCard } from '@/components/cards/score-card';
import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen>
      <Header
        eyebrow="NOVEN"
        title="Welcome home"
        subtitle="A calmer way to move, breathe, and connect."
      />

      <ScoreCard
        variant="inverse"
        score={undefined}
        label="Wellness score"
        hint="Complete activities to see your weekly score."
      />

      <SectionHeader accent title="Daily activities" subtitle="Pick where to begin today." />

      <ActivityCard
        tint="accent"
        icon={
          <SymbolView
            name={{ ios: 'figure.run', android: 'directions_run', web: 'directions_run' }}
            size={26}
            tintColor={theme.accent}
          />
        }
        title="Exercise"
        description="Guided movement sessions"
        rightLabel="Open"
        onPress={() => router.push('/exercise')}
      />

      <ActivityCard
        tint="sage"
        icon={
          <SymbolView
            name={{ ios: 'figure.yoga', android: 'self_improvement', web: 'self_improvement' }}
            size={26}
            tintColor={theme.accentSecondary}
          />
        }
        title="Yoga"
        description="Gentle practice for every body"
        rightLabel="Beginner"
        onPress={() => router.push('/yoga')}
      />

      <ActivityCard
        tint="sage"
        icon={
          <SymbolView
            name={{ ios: 'brain.head.profile', android: 'spa', web: 'spa' }}
            size={26}
            tintColor={theme.accentSecondary}
          />
        }
        title="Meditation"
        description="Short calm moments, anytime"
        onPress={() => router.push('/meditation')}
      />

      <SectionHeader accent title="Primitives" subtitle="Design system building blocks in use." />

      <Card variant="sage" gap={Spacing.three}>
        <Button
          variant="primary"
          title="Start a session"
          onPress={() => router.push('/exercise')}
        />
        <Button variant="secondary" title="Open settings" onPress={() => router.push('/settings')} />
        <Button
          variant="outline"
          title="Review result"
          onPress={() => router.push('/exercise/result')}
        />
      </Card>
    </Screen>
  );
}