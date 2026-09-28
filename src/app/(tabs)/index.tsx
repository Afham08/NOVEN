import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet } from 'react-native';

import { ActivityCard } from '@/components/cards/activity-card';
import { ScoreCard } from '@/components/cards/score-card';
import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { Radius, Spacing } from '@/constants/theme';
import { useProgress } from '@/hooks/use-progress';
import { useTheme } from '@/hooks/use-theme';
import { progressHint } from '@/exercise/progress';
import { sessionStore } from '@/exercise/session-storage';

/**
 * The landing screen: a greeting, today's activity, the progress summary, and a
 * way into Settings.
 *
 * Home deliberately does not list Exercise, Yoga and Meditation one by one. That
 * list is what the Activities tab is for, and repeating it here would give a
 * person two different-looking menus to the same four things. Home answers three
 * questions instead: what can I do today, how am I doing, and where do I change
 * how the app behaves.
 *
 * The progress card is the real one, read from stored sessions. Its detail — the
 * chart and the full session list — lives on the Progress tab, so this screen
 * stays short enough to read at a glance.
 */
export default function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();

  /** One read of the stored history feeds the progress card. */
  const { summary, totalSessions } = useProgress(sessionStore);

  return (
    <Screen>
      <Header
        eyebrow="NOVEN"
        title="Welcome home"
        subtitle="A calmer way to move, breathe, and connect."
        trailing={<SettingsButton onPress={() => router.push('/settings')} />}
      />

      {/*
        Real progress from stored sessions. The score is the latest measured
        steadiness; it stays in its empty state until there is a real session to
        show, and never shows a placeholder number.
      */}
      <ScoreCard
        variant="inverse"
        emphasis="sage"
        score={summary?.latest?.score}
        label="Progress score"
        hint={progressHint(summary, totalSessions)}
      />

      <SectionHeader accent title="Today" subtitle="Pick where to begin today." />

      <ActivityCard
        tint="accent"
        icon={
          <SymbolView
            name={{ ios: 'square.grid.2x2', android: 'apps', web: 'apps' }}
            size={26}
            tintColor={theme.accent}
          />
        }
        title="Choose an activity"
        description="Exercise, Yoga, Meditation and Wellness"
        rightLabel="Open"
        onPress={() => router.navigate('/activities')}
      />

      <SectionHeader accent title="Your progress" subtitle="How your movement has been going." />

      <ActivityCard
        tint="sage"
        icon={
          <SymbolView
            name={{ ios: 'chart.line.uptrend.xyaxis', android: 'insights', web: 'insights' }}
            size={26}
            tintColor={theme.accentSecondary}
          />
        }
        title="See your progress"
        description="Your last 30 days and every session"
        rightLabel="Open"
        onPress={() => router.navigate('/progress')}
      />

      <SectionHeader accent title="Settings" subtitle="Change how NOVEN works for you." />

      <Button
        variant="secondary"
        title="Open settings"
        leading={
          <SymbolView
            name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
            size={22}
            tintColor={theme.onAccent}
          />
        }
        onPress={() => router.push('/settings')}
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

/**
 * The gear in the header, which is the fastest route into Settings and the reason
 * Settings does not need a permanent slot in the tab bar.
 *
 * 48x48 is the smallest target that is comfortable to hit, and the label is
 * repeated in the accessibility string so the button is never announced as an
 * unlabelled image.
 */
function SettingsButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      accessibilityHint="Opens settings, where you can change how NOVEN works for you"
      style={({ pressed }) => [
        styles.settingsButton,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: theme.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <SymbolView
        name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
        size={26}
        tintColor={theme.text}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  settingsButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.control,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
