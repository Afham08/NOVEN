import { useRouter } from 'expo-router';

import type { GuidedActivityKind } from '@/activities/types';
import { Screen } from '@/components/layout/screen';
import { Button } from '@/components/ui/button';
import { Header } from '@/components/ui/header';

/**
 * What a guided activity's own route shows when the id in the path is not one of
 * that kind's activities.
 *
 * Shared by all three so the wording exists once. A link back to the activity's
 * own list is offered rather than a dead end, because the only ways to arrive
 * here are a link that has gone out of date or a mistyped address, and in both
 * cases the list is where the person meant to be.
 */
export function GuidedNotFound({ kind }: { kind: GuidedActivityKind }) {
  const router = useRouter();

  return (
    <Screen>
      <Header title="Not found" />
      <Button
        variant="primary"
        title="Back"
        onPress={() => router.replace(`/${kind}`)}
      />
    </Screen>
  );
}
