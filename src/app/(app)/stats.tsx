import { useState } from 'react';
import { useCanWrite, useMembership } from '@/auth/AuthProvider';
import { Text, View } from 'react-native';

import { daysAgoLocal, labelDate, todayLocal } from '@/domain/cultureCode';
import { formatRate } from '@/domain/growth';
import {
  contaminationBy,
  DIMENSION_LABEL,
  type Dimension,
  type Group,
  growthByStrain,
  overall,
} from '@/domain/stats';
import { addDays, beforeAfter, type Bucket, type Comparison, contaminationTrend, defaultBucket, MIN_PLATES } from '@/domain/trend';
import type { TechniqueChange } from '@/domain/types';
import { addTechniqueChange, itemChecks, listTechniqueChanges, removeTechniqueChange, statsRows } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, Field, LinkText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { TrendChart } from '@/ui/TrendChart';
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
  const [bucketChoice, setBucketChoice] = useState<Bucket | null>(null);
  const bucket = bucketChoice ?? defaultBucket(Number(days));
  const today = todayLocal();
  const periodFrom = daysAgoLocal(Number(days));
  const data = useData(async () => {
    const changes = await listTechniqueChanges();
    // Also fetch the month before each change, for before/after (nothing extra without changes).
    const earliest = [periodFrom, ...changes.map((c) => addDays(c.changed_on, -30))].sort()[0];
    const wide = await statsRows(earliest, today);
    const rows = wide.filter((r) => r.made_on >= periodFrom);
    const checks = await itemChecks(rows.map((r) => r.id));
    return { rows, wide, checks, changes };
  }, days);

  const rows = data.data?.rows ?? [];
  const changes = data.data?.changes ?? [];
  const trend = contaminationTrend(rows, periodFrom, today, bucket);
  const newestFirst = [...changes].reverse();
  const numberOf = new Map(changes.map((c, i) => [c.id, i + 1]));
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

      {data.data && (
        <>
          <SectionTitle>Over time</SectionTitle>
          <Choices<Bucket>
            label="Per"
            value={bucket}
            onChange={setBucketChoice}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
            ]}
          />
          <TrendChart
            points={trend}
            markers={changes.filter((c) => c.changed_on >= periodFrom).map((c) => ({ n: numberOf.get(c.id)!, date: c.changed_on }))}
          />
          <Muted>n = plates made that {bucket}. A point from only a few plates can swing a lot.</Muted>

          <TechniqueChanges
            changes={newestFirst}
            numberOf={numberOf}
            compare={(c) => beforeAfter(data.data!.wide, c.changed_on, today)}
            onChange={data.reload}
          />
        </>
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

function comparisonText(c: Comparison): { line: string; verdict: string } {
  const side = (s: Comparison['before']) => (s.total ? `${percent(s.rate ?? 0)} of ${s.total}` : 'no plates');
  const line = `30 days before: ${side(c.before)} · since: ${side(c.after)}`;
  const p = c.pValue === null ? '' : ` (p = ${c.pValue < 0.001 ? '<0.001' : c.pValue.toFixed(2)})`;
  const verdict = {
    too_few: `Too few plates to compare yet (need ${MIN_PLATES} on each side).`,
    better: `Likely a real improvement${p}.`,
    worse: `Likely got worse${p}.`,
    unclear: `Could be chance${p}. Keep going and check again later.`,
  }[c.verdict];
  return { line, verdict };
}

/** Dated changes in technique, each compared before and after; owners and techs add them. */
function TechniqueChanges({
  changes,
  numberOf,
  compare,
  onChange,
}: {
  changes: TechniqueChange[];
  numberOf: Map<string, number>;
  compare: (c: TechniqueChange) => Comparison;
  onChange: () => Promise<void>;
}) {
  const { account_id } = useMembership();
  const canWrite = useCanWrite();
  const [date, setDate] = useState(todayLocal());
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function add() {
    // A real calendar day: browsers roll 2026-02-31 over to March 3, so check it comes back unchanged.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || addDays(date, 0) !== date) return setError('Date is YYYY-MM-DD.');
    if (date > todayLocal()) return setError('That date is in the future.');
    if (!title.trim()) return setError('Say what changed, e.g. "Started using a flow hood".');
    setBusy(true);
    setError(null);
    try {
      await addTechniqueChange({ accountId: account_id, changedOn: date, title, note });
      setTitle('');
      setNote('');
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await removeTechniqueChange(id);
      setConfirming(null);
      await onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>Technique changes</SectionTitle>
      <Muted>
        Note the day you change how you work (a flow hood, a new recipe, longer sterilization). Each shows as a numbered
        line on the chart, and the plates made 30 days before and after are compared.
      </Muted>
      {changes.length === 0 && <Muted>None yet.</Muted>}
      {changes.map((c) => {
        const t = comparisonText(compare(c));
        return (
          <Card key={c.id}>
            <Text style={styles.codeSmall}>{`${numberOf.get(c.id)} · ${c.title}`}</Text>
            <Muted>{labelDate(c.changed_on)}</Muted>
            {c.note ? <Text style={styles.body}>{c.note}</Text> : null}
            <Text style={styles.body} testID="technique-compare">
              {t.line}
            </Text>
            <Muted>{t.verdict}</Muted>
            {canWrite &&
              (confirming === c.id ? (
                <View style={[styles.row, { gap: space.md }]}>
                  <LinkText title="Keep" onPress={() => setConfirming(null)} />
                  <LinkText title="Remove change" onPress={() => remove(c.id)} />
                </View>
              ) : (
                <LinkText title="Remove" onPress={() => setConfirming(c.id)} />
              ))}
          </Card>
        );
      })}
      {canWrite && (
        <Card>
          <Field label="What changed" value={title} onChangeText={setTitle} placeholder="Started using a flow hood" maxLength={80} />
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" />
          <Field label="Details (optional)" value={note} onChangeText={setNote} multiline maxLength={500} />
          <Button title="Add change" busy={busy} onPress={add} />
        </Card>
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
