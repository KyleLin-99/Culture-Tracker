import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { labelDate, MEDIUM_LABEL, STATUS_LABEL } from '@/domain/cultureCode';
import type { ItemStatus, Medium } from '@/domain/types';

import { Card, StatusPill, styles } from './components';
import { colors, font } from './theme';

type Props = {
  id: string;
  code: string;
  strainName?: string | null;
  medium: Medium;
  status: ItemStatus;
  madeOn: string;
  initials: string;
};

/** One culture as it would read on its label: strain · date · initials · code. */
export function ItemRow({ id, code, strainName, medium, status, madeOn, initials }: Props) {
  return (
    <Card onPress={() => router.push({ pathname: '/items/[id]', params: { id } })}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={styles.codeSmall}>{code}</Text>
        {status !== 'active' && <StatusPill status={status} label={STATUS_LABEL[status]} />}
      </View>
      <Text style={{ color: colors.muted, fontSize: font.small }}>
        {[strainName, MEDIUM_LABEL[medium], labelDate(madeOn), initials].filter(Boolean).join(' · ')}
      </Text>
    </Card>
  );
}
