import { useState } from 'react';
import { Text, View } from 'react-native';

import { daysAgoLocal } from '@/domain/cultureCode';
import { describeRow, FACTOR_LABEL, formatP, formatRisk, strength, STRENGTH_LABEL } from '@/domain/trace';
import { contaminationTrace } from '@/lib/api';
import { useData } from '@/lib/useData';
import { Card, Choices, ErrorText, Muted, Screen, StatusPill, styles } from '@/ui/components';
import { space } from '@/ui/theme';

const WINDOWS = [
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: 'Year' },
];

// Ranks what the contaminated cultures in a window have in common that the
// clean ones don't: parent, media batch, sterilization run, day made.
export default function Trace() {
  const [days, setDays] = useState('60');
  const trace = useData(() => contaminationTrace(daysAgoLocal(Number(days))), days);

  const rows = trace.data ?? [];
  const leads = rows.filter((r) => strength(r) !== 'weak');
  const contaminated = rows[0]?.contaminated_total ?? 0;
  const clean = rows[0]?.clean_total ?? 0;

  return (
    <Screen>
      <Choices<string> label="Cultures made in the last" value={days} onChange={setDays} options={WINDOWS} />
      <ErrorText>{trace.error}</ErrorText>

      {!trace.loading && rows.length === 0 && (
        <Muted>No contaminated cultures in this window. Mark a culture contaminated from its screen and it shows up here.</Muted>
      )}

      {rows.length > 0 && (
        <Text style={styles.body}>
          Comparing {contaminated} contaminated with {clean} clean cultures.{' '}
          {leads.length ? `${leads.length} likely cause${leads.length === 1 ? '' : 's'}:` : 'Nothing stands out yet.'}
        </Text>
      )}

      <View style={{ gap: space.sm }}>
        {rows.slice(0, 12).map((r) => {
          const s = strength(r);
          return (
            <Card key={`${r.factor}:${r.factor_id}`}>
              <View style={[styles.row, { justifyContent: 'space-between', flexWrap: 'wrap' }]}>
                <Text style={styles.codeSmall}>
                  {FACTOR_LABEL[r.factor]} {r.factor === 'made_on' ? '' : r.label}
                </Text>
                <StatusPill status={s === 'strong' ? 'contaminated' : s === 'possible' ? 'warn' : 'used'} label={STRENGTH_LABEL[s]} />
              </View>
              <Text style={styles.body}>{describeRow(r)}</Text>
              <Muted>
                {formatRisk(r.relative_risk)} · {formatP(r.p_value)}
              </Muted>
            </Card>
          );
        })}
      </View>

      {rows.length > 0 && (
        <Muted>
          Relative risk compares the contamination rate with and without each cause. The p value is the chance of a
          pattern this strong if the cause made no difference (one-sided Fisher&apos;s exact test). With only a few
          cultures, treat these as leads to check, not proof.
        </Muted>
      )}
    </Screen>
  );
}
