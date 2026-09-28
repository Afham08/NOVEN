import { useRouter } from 'expo-router';

import { ActivityCard } from '@/components/cards/activity-card';
import { Screen } from '@/components/layout/screen';
import { SectionHeader } from '@/components/ui/section-header';

/**
 * The six settings sections, in the order a person is most likely to want them.
 *
 * `detail` is the current state, shown on the right of each row. Two of these
 * strings are facts about how NOVEN behaves today and two are honest admissions
 * that a feature is missing; none of them is a promise the app cannot keep:
 *
 *   - Language "English"      every string in the app is written in English and
 *                             there is no language setting, so this is a
 *                             description, not a preference being stored.
 *   - Appearance "Follows your phone"  the app really does read the device
 *                             setting (app.json userInterfaceStyle automatic),
 *                             so NOVEN is not choosing and the row must not
 *                             pretend it is.
 *   - Notifications "Not available yet"  the app has no notification code at all.
 *
 * Kept as data rather than six hand-written blocks so the list, the order, and
 * the wording can be checked in one place.
 */
const SECTIONS = [
  {
    title: 'Family',
    description: 'Connect family members to your account',
    detail: 'Not set up',
    href: '/settings/family',
  },
  {
    title: 'Language',
    description: 'The language NOVEN shows you',
    detail: 'English',
    href: '/settings/language',
  },
  {
    title: 'Appearance',
    description: 'Light, dark, or follow your phone',
    detail: 'Follows your phone',
    href: '/settings/appearance',
  },
  {
    title: 'Notifications',
    description: 'Reminders and alerts',
    detail: 'Not available yet',
    href: '/settings/notifications',
  },
  {
    title: 'Privacy & Safety',
    description: 'Camera, your history, and your data',
    detail: 'Review',
    href: '/settings/privacy',
  },
  {
    title: 'About NOVEN',
    description: 'Version and app details',
    detail: 'Details',
    href: '/settings/about',
  },
] as const;

export default function SettingsScreen() {
  const router = useRouter();

  return (
    <Screen>
      {/*
        The page heading is the stack header above this screen, which is also the
        visible way back to Home. Repeating it here would put "Settings" twice in
        the same few centimetres.
      */}
      {/*
        No subtitle. The stack header above already says "Settings", and every
        row below names the thing it opens, so an introductory line explaining
        that you can change how the app works was just the title a third time.
      */}
      <SectionHeader accent title="Settings" />

      {SECTIONS.map((section) => (
        <ActivityCard
          key={section.href}
          title={section.title}
          description={section.description}
          rightLabel={section.detail}
          onPress={() => router.push(section.href)}
        />
      ))}
    </Screen>
  );
}
