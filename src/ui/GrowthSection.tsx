import { useState } from 'react';
import { Text, View } from 'react-native';

import { labelDate, todayLocal } from '@/domain/cultureCode';
import { formatRate, growth, METRIC_UNIT, SLOW_RATIO, vigor } from '@/domain/growth';
import type { ColonizationCheck, TreeRow } from '@/domain/types';
import { itemChecks, logCheck, removeCheck } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';

import { Button, Card, ErrorText, Field, LinkText, Muted, SectionTitle, styles } from './components';
import { colors, font, space } from './theme';

type Culture = { id: string; code: string; made_on: string; generation: number };

/** A number from a field, or null when blank. NaN marks something unreadable. */
function parseNumber(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text.replace(',', '.').replace('%', ''));
  return Number.isFinite(n) ? n : NaN;
}

const describe = (c: Pick<ColonizationCheck, 'percent' | 'radius_mm'>) =>
  [c.percent !== null ? `${c.percent}%` : null, c.radius_mm !== null ? `${c.radius_mm} mm` : null].filter(Boolean).join(' · ');

/**
 * Growth check-ins for one culture, its growth rate, and how it compares with its
 * ancestors (senescence). `ancestors` oldest first.
 */
export function GrowthSection({ culture, ancestors, canLog }: { culture: Culture; ancestors: TreeRow[]; canLog: boolean }) {
  const ids = [...ancestors.map((a) => a.id), culture.id];
  const checks = useData(() => itemChecks(ids), ids.join(','));

  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState('');
  const [radius, setRadius] = useState('');
  const [day, setDay] = useState('');
  const [note, setNote] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = checks.data ?? [];
  const mine = all.filter((c) => c.item_id === culture.id);
  const growthOf = (id: string, madeOn: string) => growth(madeOn, all.filter((c) => c.item_id === id));
  const own = growthOf(culture.id, culture.made_on);
  const v = vigor(
    ancestors.map((a) => ({ id: a.id, code: a.code, generation: a.generation, growth: growthOf(a.id, a.made_on) })),
    { id: culture.id, code: culture.code, generation: culture.generation, growth: own },
  );
  const maxRate = Math.max(0, ...(v?.rows.map((r) => r.rate ?? 0) ?? []));

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await checks.reload();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const p = parseNumber(percent);
    const r = parseNumber(radius);
    if (Number.isNaN(p) || Number.isNaN(r)) return setError('Enter numbers only, e.g. 40 and 18.');
    if (p === null && r === null) return setError('Enter percent colonized, radius, or both.');
    if (p !== null && (p < 0 || p > 100)) return setError('Percent is between 0 and 100.');
    if (r !== null && (r <= 0 || r > 500)) return setError('Radius is in mm, more than 0.');
    const checkedOn = day.trim() || todayLocal();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) return setError('Date is YYYY-MM-DD.');
    const ok = await run(() => logCheck({ itemId: culture.id, checkedOn, percent: p, radiusMm: r, note }));
    if (ok) {
      setPercent('');
      setRadius('');
      setDay('');
      setNote('');
      setOpen(false);
    }
  }

  const rates = [
    own.mmPerDay !== null ? formatRate(own.mmPerDay, 'mmPerDay') : null,
    own.percentPerDay !== null ? formatRate(own.percentPerDay, 'percentPerDay') : null,
    own.daysToFull !== null ? `full in ${own.daysToFull} days` : null,
  ].filter(Boolean);

  return (
    <View style={{ gap: space.sm }} testID="growth-section">
      <SectionTitle>Growth</SectionTitle>
      <ErrorText>{checks.error ?? error}</ErrorText>

      {rates.length ? (
        <Text style={styles.body} testID="growth-rate">
          {rates.join(' · ')}
          <Text style={{ color: colors.muted }}>
            {' '}
            from {own.checks} check{own.checks === 1 ? '' : 's'}
          </Text>
        </Text>
      ) : (
        <Muted>No checks yet. Log how far it has grown every few days to get its growth rate.</Muted>
      )}

      {v?.slow && (
        <View style={{ backgroundColor: colors.warnBg, borderRadius: 12, padding: space.md }} testID="slow-warning">
          <Text style={{ color: colors.warn, fontSize: font.body }}>
            Growing {Math.round((1 - v.ratio!) * 100)}% slower than its ancestors ({formatRate(v.rows.at(-1)!.rate!, v.metric)} vs{' '}
            {formatRate(v.ancestorAverage!, v.metric)}). It may be losing vigor; consider going back to an earlier backup.
          </Text>
        </View>
      )}

      {v && v.ancestorAverage !== null && (
        <Card>
          <Muted>Vigor by generation ({METRIC_UNIT[v.metric]})</Muted>
          {v.rows.map((r) => (
            <View key={r.id} style={[styles.row, { gap: space.sm }]} testID="vigor-row">
              <Text style={[styles.body, { width: 110 }]} numberOfLines={1}>
                {r.code}
              </Text>
              <View style={{ flex: 1, height: 10, backgroundColor: colors.border, borderRadius: 5, overflow: 'hidden' }}>
                {r.rate !== null && maxRate > 0 && (
                  <View
                    style={{
                      width: `${(r.rate / maxRate) * 100}%`,
                      height: '100%',
                      backgroundColor: r.id === culture.id && v.slow ? colors.warn : colors.primary,
                    }}
                  />
                )}
              </View>
              <Text style={[styles.body, { width: 48, textAlign: 'right' }]}>{r.rate === null ? '–' : Number(r.rate.toFixed(1))}</Text>
            </View>
          ))}
          <Muted>
            Flagged below {Math.round(SLOW_RATIO * 100)}% of the ancestors&apos; average, once there are 2 or more checks.
          </Muted>
        </Card>
      )}

      {canLog && (
        <Button title="Log growth check" variant="secondary" onPress={() => { setError(null); setOpen(!open); }} />
      )}
      {open && (
        <Card>
          <View style={[styles.row, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1 }}>
              <Field label="Colonized (%)" value={percent} onChangeText={setPercent} keyboardType="numeric" placeholder="40" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Radius (mm)" value={radius} onChangeText={setRadius} keyboardType="numeric" placeholder="18" />
            </View>
          </View>
          <Field label="Date" value={day} onChangeText={setDay} placeholder={todayLocal()} autoCapitalize="none" />
          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Even, rhizomorphic" />
          <Button title="Save check" busy={busy} onPress={save} />
        </Card>
      )}

      {mine.length > 0 && (
        <View style={{ gap: space.xs }}>
          {[...mine].reverse().map((c) => (
            <Card key={c.id}>
              <Text style={styles.body} testID="check-row">
                {labelDate(c.checked_on)} · {describe(c)}
                {c.note ? ` · ${c.note}` : ''}
              </Text>
              {removing === c.id ? (
                <View style={[styles.row, { gap: space.sm }]}>
                  <View style={{ flex: 1 }}>
                    <Button title="Remove check" variant="danger" busy={busy} onPress={() => run(() => removeCheck(c.id))} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Keep" variant="secondary" onPress={() => setRemoving(null)} />
                  </View>
                </View>
              ) : (
                <LinkText title="Remove" onPress={() => setRemoving(c.id)} />
              )}
            </Card>
          ))}
        </View>
      )}
    </View>
  );
}
