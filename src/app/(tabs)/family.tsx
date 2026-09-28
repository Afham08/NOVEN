import { FamilyScreen } from '@/components/family/family-screen';

/**
 * Family as a primary bottom tab.
 *
 * The page is the same one the Settings row opens — see `FamilyScreen`. Routing
 * it here is the only reason this file exists, so the two entry points cannot
 * drift into showing different things.
 */
export default function FamilyTabScreen() {
  return <FamilyScreen />;
}
