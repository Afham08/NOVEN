import { Screen } from '@/components/layout/screen';
import { ComingSoonNote } from '@/components/settings/coming-soon-note';
import { Card } from '@/components/ui/card';
import { Header } from '@/components/ui/header';
import { InfoRow } from '@/components/ui/info-row';
import { Spacing } from '@/constants/theme';

export default function NotificationSettingsScreen() {
  /*
   * There is no notification support in the app: no notification library, no
   * permission request, and nothing that schedules a reminder. There are also no
   * existing settings to reuse here, so the page reports that state directly
   * rather than presenting toggles that switch nothing.
   */
  return (
    <Screen>
      <Header title="Notifications" />

      <Card gap={Spacing.three}>
        <InfoRow label="Reminders" value="Not available yet" stacked />
        <InfoRow label="Alerts" value="Not available yet" stacked />
      </Card>

      {/*
        The message is kept here, unlike on the other pages, because it says the
        one thing a user might otherwise be left guessing: that NOVEN sends
        nothing at all. Someone who has turned on notifications elsewhere on
        their phone could otherwise keep waiting for a reminder that will never
        arrive. That is a limitation worth a sentence; the two rows above are not
        enough to carry it on their own.
      */}
      <ComingSoonNote
        title="Reminders are not available yet"
        message="NOVEN does not send reminders or alerts at the moment."
      />
    </Screen>
  );
}
