import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { useCanWrite, useMembership } from '@/auth/AuthProvider';
import { KIND_LABEL, RECIPE_TEMPLATES } from '@/domain/recipes';
import type { Ingredient, MediaKind } from '@/domain/types';
import { recipeVersions, saveRecipe } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { Button, Card, Choices, ErrorText, Field, LinkText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { space } from '@/ui/theme';

const KINDS: { value: MediaKind; label: string }[] = (['agar', 'lc', 'other'] as const).map((k) => ({
  value: k,
  label: KIND_LABEL[k],
}));

/** Ingredient rows as typed: amounts stay text until saved. */
type Row = { name: string; amount: string; unit: string };
const blankRow = (): Row => ({ name: '', amount: '', unit: 'g' });
const toRows = (list: Ingredient[]): Row[] => list.map((i) => ({ name: i.name, amount: String(i.amount), unit: i.unit }));
const num = (t: string) => Number(t.replace(',', '.'));

/** New recipe, or (with ?familyId) the next version of one. */
export default function EditRecipe() {
  const { familyId } = useLocalSearchParams<{ familyId?: string }>();
  const { account_id } = useMembership();
  const canWrite = useCanWrite();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<MediaKind>('agar');
  const [volume, setVolume] = useState('500');
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [steps, setSteps] = useState('');
  const [nextVersion, setNextVersion] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing: start from the newest version.
  useEffect(() => {
    if (!familyId) return;
    let live = true;
    recipeVersions(familyId)
      .then(([latest]) => {
        if (!live || !latest) return;
        setName(latest.name);
        setKind(latest.kind);
        setVolume(String(latest.volume_ml));
        setRows(toRows(latest.ingredients));
        setSteps(latest.steps ?? '');
        setNextVersion(latest.version + 1);
      })
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, [familyId]);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  function applyTemplate(t: (typeof RECIPE_TEMPLATES)[number]) {
    setName(t.name);
    setKind(t.kind);
    setVolume(String(t.volume_ml));
    setRows(toRows(t.ingredients));
  }

  async function save() {
    const filled = rows.filter((r) => r.name.trim() || r.amount.trim());
    if (!name.trim()) return setError('Give the recipe a name.');
    if (!(num(volume) > 0)) return setError('Batch size must be more than 0 ml.');
    if (!filled.length) return setError('Add at least one ingredient.');
    if (filled.some((r) => !r.name.trim() || !r.unit.trim() || !r.amount.trim() || !(num(r.amount) >= 0))) {
      return setError('Each ingredient needs a name, an amount and a unit.');
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await saveRecipe({
        accountId: account_id,
        familyId: familyId ?? null,
        name,
        kind,
        volumeMl: num(volume),
        ingredients: filled.map((r) => ({ name: r.name.trim(), amount: num(r.amount), unit: r.unit.trim() })),
        steps,
      });
      if (familyId) router.back();
      else router.replace({ pathname: '/recipes/[id]', params: { id: saved.family_id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite) {
    return (
      <Screen>
        <Muted>Viewers can&apos;t change this lab.</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: familyId ? `Edit ${name || 'recipe'}` : 'New recipe' }} />
      {familyId ? (
        <Muted>
          Saving makes version {nextVersion ?? '…'}. Batches already made keep the version they used.
        </Muted>
      ) : (
        <View style={{ gap: space.xs }}>
          <Muted>Start from a common recipe, then change it to match yours:</Muted>
          <View style={[styles.row, { gap: space.lg, flexWrap: 'wrap' }]}>
            {RECIPE_TEMPLATES.map((t) => (
              <LinkText key={t.name} title={t.name} onPress={() => applyTemplate(t)} />
            ))}
          </View>
        </View>
      )}

      <Field label="Name" value={name} onChangeText={setName} placeholder="MEA 2%" maxLength={60} />
      <Choices<MediaKind> label="Kind" value={kind} onChange={setKind} options={KINDS} />
      <Field label="Makes (ml)" value={volume} onChangeText={setVolume} keyboardType="numeric" placeholder="500" />

      <SectionTitle>Ingredients</SectionTitle>
      <Muted>Amounts for the batch size above. They scale when you make more or less.</Muted>
      {rows.map((r, i) => (
        <Card key={i}>
          <Field label={`Ingredient ${i + 1}`} value={r.name} onChangeText={(t) => setRow(i, { name: t })} placeholder="Light malt extract" />
          <View style={[styles.row, { alignItems: 'flex-start' }]}>
            <View style={{ flex: 1 }}>
              <Field
                label="Amount"
                value={r.amount}
                onChangeText={(t) => setRow(i, { amount: t })}
                keyboardType="numeric"
                placeholder="10"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Unit" value={r.unit} onChangeText={(t) => setRow(i, { unit: t })} placeholder="g" autoCapitalize="none" />
            </View>
          </View>
          {rows.length > 1 && (
            <LinkText title="Remove ingredient" onPress={() => setRows((rs) => rs.filter((_, n) => n !== i))} />
          )}
        </Card>
      ))}
      <Button title="Add ingredient" variant="secondary" onPress={() => setRows((rs) => [...rs, blankRow()])} />

      <Field
        label="Steps (optional)"
        value={steps}
        onChangeText={setSteps}
        multiline
        placeholder="Mix, cook 45 min at 15 psi, pour at about 50 °C"
      />

      <ErrorText>{error}</ErrorText>
      <Button title={familyId ? `Save version ${nextVersion ?? ''}`.trim() : 'Save recipe'} busy={busy} onPress={save} />
    </Screen>
  );
}
