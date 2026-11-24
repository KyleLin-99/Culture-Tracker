import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { backupsDue, dueText } from '@/domain/backups';
import { labelDate, MEDIUM_LABEL, todayLocal } from '@/domain/cultureCode';
import { activeBackups, backupRefreshDays } from '@/lib/api';
import { useData } from '@/lib/useData';

import { Card, ErrorText, LinkText, Muted, SectionTitle, styles } from './components';
import { colors, space } from './theme';

/** Home-screen list of backups past (or close to) their refresh age. Hidden when none. */
export function BackupsDue() {
  const data = useData(async () => {
    const [backups, days] = await Promise.all([activeBackups(), backupRefreshDays()]);
    return backupsDue(backups, days, todayLocal());
  });
  if (data.error) return <ErrorText>{data.error}</ErrorText>;
  if (!data.data?.length) return null;

  return (
    <View style={{ gap: space.sm }} testID="backups-due">
      <SectionTitle>Backups due</SectionTitle>
      <Muted>Make a fresh backup from these, then retire the old one.</Muted>
      {data.data.map((d) => (
        <Card key={d.backup.id} onPress={() => router.push({ pathname: '/items/[id]', params: { id: d.backup.id } })}>
          <Text style={styles.codeSmall}>{d.backup.code}</Text>
          <Text style={{ color: d.state === 'overdue' ? colors.warn : colors.muted }} testID="due-text">
            {dueText(d.overdueDays)} · {MEDIUM_LABEL[d.backup.medium]} made {labelDate(d.backup.made_on)}
            {d.backup.strains?.name ? ` · ${d.backup.strains.name}` : ''}
          </Text>
        </Card>
      ))}
      <LinkText title="Change refresh ages ›" onPress={() => router.push('/settings')} />
    </View>
  );
}
