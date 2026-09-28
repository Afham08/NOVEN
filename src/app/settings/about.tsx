import Constants from 'expo-constants';

import { Screen } from '@/components/layout/screen';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing } from '@/constants/theme';
import { exercisesCatalog } from '@/data/exercises';

/**
 * Reads the version out of the app's own configuration rather than repeating it
 * here. A hardcoded number on this screen is a number that goes stale and then
 * quietly lies, and a wrong version is worse than a missing one — so if the
 * config ever stops exposing it, this shows a dash instead of a guess.
 */
const version = Constants.expoConfig?.version;

export default function AboutScreen() {
  return (
    <Screen>
      <Header title="About NOVEN" />

      <Card gap={Spacing.three}>
        <InfoRow label="App" value="NOVEN" emphasize stacked />
        <InfoRow label="Version" value={version ?? '—'} stacked />
        {/*
          Counted from the real catalogue rather than written out, so the number
          is true by construction.
        */}
        <InfoRow
          label="Guided exercises available"
          value={String(exercisesCatalog.length)}
          stacked
        />
      </Card>

      {/*
        No mission statement, no team, no awards, no usage numbers. Nothing on
        this screen is a claim NOVEN cannot currently back up.

        The three rows above are the whole screen. A "What NOVEN is" paragraph
        used to sit underneath them, and it was removed: it restated the app's own
        title and added no fact a person could not already see from the version
        and the real exercise count. If this screen ever needs to explain
        something, it should be explaining a version number or a data fact, not
        describing the app in its own adjectives.
      */}

    </Screen>
  );
}
