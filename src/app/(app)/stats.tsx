import { useState } from 'react';
import { Text, View } from 'react-native';

import { daysAgoLocal, todayLocal } from '@/domain/cultureCode';
import { formatRate } from '@/domain/growth';
import {
  contaminationBy,
  DIMENSION_LABEL,
  type Dimension,
  type Group,
  growthByStrain,
  overall,
} from '@/domain/stats';
import { itemChecks, statsRows } from '@/lib/api';
import { useData } from '@/lib/useData';
import { Card, Choices, ErrorText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

const PERIODS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

const DIMENSIONS: Dimension[] = ['recipe', 'run', 'batch', 'generation', 'month', 'strain'];

const percent = (x: number) => `${Math.round(x * 100)}%`;

function RateRows({ groups }: { groups: Group[] }) {
  return (
    <Card>
      {groups.map((g) => (
        <View key={g.key || 'none'} style={[styles.row, { gap: space.sm }]} testID="stat-row">
          <Text style={[styles.body, { width: 120 }]} numberOfLines={1}>
            {g.label}
          </Text>
          <View style={{ flex: 1, height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden' }}>
            <View style={{ width: `${g.rate * 100}%`, height: '100%', backgroundColor: colors.danger }} />
          </View>
          <Text style={[styles.body, { width: 92, textAlign: 'right' }]}>
            {percent(g.rate)} of {g.total}
          </Text>
        </View>
      ))}
    </Card>
  );
}

/** Contamination rates by what plates were made from, and growth by strain. */
export default function Stats() {
  const [days, setDays] = useState('90');
  const [by, setBy] = useState<Dimension>('recipe');
  const data = useData(async () => {
    const rows = await statsRows(daysAgoLocal(Number(days)), todayLocal());
    const checks = await itemChecks(rows.map((r) => r.id));
    return { rows, checks };
  }, days);

  const rows = data.data?.rows ?? [];
  const all = overall(rows);
  const groups = contaminationBy(rows, by);
  const growth = growthByStrain(rows, data.data?.checks ?? []);

  return (
    <Screen>
      <Choices<string> label="Plates made in the last" value={days} onChange={setDays} options={PERIODS} />
      <ErrorText>{data.error}</ErrorText>

      {data.data && (
        <Text style={styles.body} testID="stats-overall">
          {all.total === 0
            ? 'No transfers or backups in this period.'
            : `${all.contaminated} of ${all.total} plates contaminated (${percent(all.rate)})`}
        </Text>
      )}

      {all.total > 0 && (
        <>
          <SectionTitle>Contamination by</SectionTitle>
          <Choices<Dimension>
            label="Group by"
            value={by}
            onChange={setBy}
            options={DIMENSIONS.map((d) => ({ value: d, label: DIMENSION_LABEL[d] }))}
          />
          <RateRows groups={groups} />
          <Muted>
            Clean plates that were discarded aren’t counted. To find a likely cause, use Contamination trace, which also
            checks whether a difference is more than chance.
          </Muted>

          <SectionTitle>Growth by strain</SectionTitle>
          {growth.length === 0 ? (
            <Muted>No growth checks on these plates yet.</Muted>
          ) : (
            <View style={{ gap: space.sm }}>
              {growth.map((g) => (
                <Card key={g.strainId}>
                  <Text style={styles.codeSmall}>{g.name}</Text>
                  <Text style={styles.body} testID="strain-growth">
                    {[
                      g.mmPerDay !== null ? formatRate(g.mmPerDay, 'mmPerDay') : null,
                      g.percentPerDay !== null ? formatRate(g.percentPerDay, 'percentPerDay') : null,
                      g.daysToFull !== null ? `full in ${g.daysToFull} days (${g.fullCount})` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Muted>
                    Average over {g.cultures} culture{g.cultures === 1 ? '' : 's'} with checks
                  </Muted>
                </Card>
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}
