import { useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { Header } from '@/components/ui/header';
import { SectionHeader } from '@/components/ui/section-header';
import { useTheme } from '@/hooks/use-theme';
import { exercisesCatalog } from '@/data/exercises';

/**
 * The four things a person can do in NOVEN, on one screen.
 *
 * DESIGN INTENT
 * These used to be four separate bottom tabs, side by side with Home and
 * Settings. That made six items in a bar across the bottom of the screen, and it
 * would have kept growing: more exercises, more practices, more sections. The
 * bar is the worst possible place to add a feature in an app used by people who
 * want one obvious choice, not a menu.
 *
 * So the bar now holds four destinations that never move, and everything a
 * person can *do* lives here instead. Adding a new kind of activity later adds a
 * card to this page and leaves the bar alone.
 *
 * The cards are ordered the way a day goes: move, stretch, settle, and check in.
 * Each one leads to the screen that already existed, so nothing about Exercise,
 * Yoga, Meditation or Wellness changes here — the only honest thing to say about
 * the three that are not built yet is what they were always going to say.
 */
const ACTIVITIES = [
  {
    name: 'exercise',
    title: 'Exercise',
    description: 'Guided movement sessions with your camera',
    rightLabel: 'Open',
    tint: 'accent' as const,
    icon: {
      ios: 'figure.run',
      android: 'directions_run',
      web: 'directions_run',
    } as const,
  },
  {
    name: 'yoga',
    title: 'Yoga',
    description: 'Gentle practice for every body',
    rightLabel: 'Open',
    tint: 'sage' as const,
    icon: {
      ios: 'figure.yoga',
      android: 'self_improvement',
      web: 'self_improvement',
    } as const,
  },
  {
    name: 'meditation',
    title: 'Meditation',
    description: 'Short calm moments, anytime',
    rightLabel: 'Open',
    tint: 'sage' as const,
    icon: {
      ios: 'brain.head.profile',
      android: 'spa',
      web: 'spa',
    } as const,
  },
  {
    name: 'wellness',
    title: 'Wellness',
    description: 'How your movement is going over time',
    rightLabel: 'Open',
    tint: 'accent' as const,
    icon: {
      ios: 'heart',
      android: 'favorite',
      web: 'favorite',
    } as const,
  },
] as const;

export default function ActivitiesScreen() {
  const theme = useTheme();
  const router = useRouter();

  return (
    <Screen>
      {/*
        The "Choose what you would like to do today" subtitle and the "What you
        can do" section heading were both removed. The page title already says
        Activities, and four cards titled Exercise, Yoga, Meditation and Wellness
        need no introduction before they are understandable. The card titles and
        descriptions are kept: those are the labels the user is choosing between,
        not commentary about them.
      */}
      <Header title="Activities" />

      {ACTIVITIES.map((activity) => (
        <ActivityCard
          key={activity.name}
          tint={activity.tint}
          icon={
            <SymbolView
              name={activity.icon}
              size={26}
              tintColor={activity.tint === 'accent' ? theme.accent : theme.accentSecondary}
            />
          }
          title={activity.title}
          description={activity.description}
          rightLabel={activity.rightLabel}
          onPress={() => router.push(`/${activity.name}`)}
        />
      ))}

      {/*
        An honest count, read from the real catalogue rather than typed in, so it
        cannot drift away from what is actually available to start.
      */}
      <SectionHeader accent title="Getting started" />
      <ActivityCard
        title="Exercises ready to try"
        description={
          exercisesCatalog.length === 1
            ? 'One guided movement session is ready now.'
            : `${exercisesCatalog.length} guided movement sessions are ready now.`
        }
        rightLabel="See all"
        onPress={() => router.push('/exercise')}
      />
    </Screen>
  );
}
