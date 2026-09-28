import { FamilyScreen } from '@/components/family/family-screen';

/**
 * The Family row in Settings.
 *
 * The page itself lives in `FamilyScreen`, which the Family tab also renders, so
 * there is only one Family screen to keep honest. This route exists because
 * Family is listed inside Settings as well as being a tab of its own.
 *
 * The heading is not repeated here: the stack header above this screen is the
 * visible way back to Home, and it already carries the title.
 */
export default function FamilySettingsScreen() {
  return <FamilyScreen showHeader={false} />;
}
