import { Screen } from '@/components/layout/screen';
import { ComingSoonNote } from '@/components/settings/coming-soon-note';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing } from '@/constants/theme';

export default function LanguageSettingsScreen() {
  return (
    <Screen>
      <Header title="Language" />

      {/*
        One row, and it is a fact rather than a preference. Every string in
        NOVEN is written directly in the source, so there is no translation
        layer and no stored language to report. Listing a language picker full
        of choices that would do nothing would be the single most misleading
        thing this page could do, so it shows the one real answer instead.
      */}
      <Card gap={Spacing.three}>
        <InfoRow label="Current language" value="English" emphasize stacked />
      </Card>

      {/*
        The heading is the whole message here. The row above already says the
        language is English, so a second paragraph explaining that NOVEN is
        written in English would just repeat it. What the user still needs to know
        is that they cannot change it, which the heading says.
      */}
      <ComingSoonNote title="Choosing a language is not available yet" />
    </Screen>
  );
}
