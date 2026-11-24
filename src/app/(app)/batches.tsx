import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useCanWrite, useMembership } from '@/auth/AuthProvider';
import { labelDate } from '@/domain/cultureCode';
import { formatVolume, recipeLabel, scaleIngredients } from '@/domain/recipes';
import type { MediaKind, SterilizationMethod } from '@/domain/types';
import { createBatch, createRun, listBatches, listRecipes, listRuns } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, Field, LinkText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { IngredientCard } from '@/ui/Ingredients';
import { space } from '@/ui/theme';

const METHODS: { value: SterilizationMethod; label: string }[] = [
  { value: 'pressure_cooker', label: 'Pressure cooker' },
  { value: 'autoclave', label: 'Autoclave' },
  { value: 'pasteurize', label: 'Pasteurize' },
  { value: 'other', label: 'Other' },
];
const METHOD_LABEL = Object.fromEntries(METHODS.map((m) => [m.value, m.label])) as Record<SterilizationMethod, string>;

const KINDS: { value: MediaKind; label: string }[] = [
  { value: 'agar', label: 'Agar' },
  { value: 'lc', label: 'Liquid culture' },
  { value: 'other', label: 'Other' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.value, k.label])) as Record<MediaKind, string>;

/** A positive number from a text field, or null when blank. */
function numberOrNull(text: string): number | null {
  const n = Number(text.replace(',', '.'));
  return text.trim() && Number.isFinite(n) && n > 0 ? n : null;
}

// Log a sterilization run, then the media batches that went through it, before
// pouring or loading. Transfers can then record their batch, which is what the
// contamination trace compares.
export default function Batches() {
  const { account_id } = useMembership();
  const canWrite = useCanWrite();
  const runs = useData(() => listRuns());
  const batches = useData(() => listBatches());
  const recipes = useData(() => listRecipes());

  const [method, setMethod] = useState<SterilizationMethod>('pressure_cooker');
  const [psi, setPsi] = useState('15');
  const [minutes, setMinutes] = useState('');
  const [runNotes, setRunNotes] = useState('');

  const [kind, setKind] = useState<MediaKind>('agar');
  const [recipe, setRecipe] = useState('');
  const [runId, setRunId] = useState('');
  const [recipeId, setRecipeId] = useState('');
  const [volume, setVolume] = useState('');

  const [busy, setBusy] = useState<'run' | 'batch' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function addRun() {
    setBusy('run');
    setError(null);
    try {
      const r = await createRun({
        accountId: account_id,
        method,
        psi: numberOrNull(psi),
        minutes: numberOrNull(minutes),
        notes: runNotes,
      });
      setMinutes('');
      setRunNotes('');
      setRunId(r.id); // the next batch most likely went through this run
      setSaved(`Logged ${r.code}`);
      await runs.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function addBatch() {
    setBusy('batch');
    setError(null);
    try {
      const b = await createBatch({
        accountId: account_id,
        kind,
        recipe,
        runId: runId || null,
        recipeId: chosen?.id ?? null,
        volumeMl: numberOrNull(volume) ?? chosen?.volume_ml ?? null,
      });
      setRecipe('');
      setVolume('');
      setSaved(`Logged ${b.code}`);
      await batches.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const recentRuns = (runs.data ?? []).slice(0, 6);
  const kindRecipes = (recipes.data ?? []).filter((r) => r.kind === kind);
  const chosen = kindRecipes.find((r) => r.id === recipeId) ?? null;
  const batchMl = numberOrNull(volume) ?? chosen?.volume_ml ?? null;

  return (
    <Screen>
      <ErrorText>{error ?? runs.error ?? batches.error}</ErrorText>
      {saved && <Text style={styles.body}>{saved}. Write the code on the jar or sleeve.</Text>}

      {canWrite && (
        <>
        <SectionTitle>Sterilization or pasteurization run</SectionTitle>
        <Choices<SterilizationMethod> label="Method" value={method} onChange={setMethod} options={METHODS} />
        <View style={[styles.row, { alignItems: 'flex-start' }]}>
          <View style={{ flex: 1 }}>
            <Field label="PSI" value={psi} onChangeText={setPsi} keyboardType="numeric" placeholder="15" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Minutes" value={minutes} onChangeText={setMinutes} keyboardType="numeric" placeholder="90" />
          </View>
        </View>
        <Field label="Notes (optional)" value={runNotes} onChangeText={setRunNotes} placeholder="Full load, 20 jars" />
        <Button title="Log run" onPress={addRun} busy={busy === 'run'} />

        <SectionTitle>Media batch</SectionTitle>
        <Choices<MediaKind> label="Kind" value={kind} onChange={setKind} options={KINDS} />
        {kindRecipes.length > 0 ? (
          <Choices<string>
            label="Recipe"
            value={chosen ? chosen.id : ''}
            onChange={setRecipeId}
            options={[{ value: '', label: 'None' }, ...kindRecipes.map((r) => ({ value: r.id, label: recipeLabel(r) }))]}
          />
        ) : (
          <LinkText title="Save a recipe to pick it here ›" onPress={() => router.push('/recipes/edit')} />
        )}
        {chosen && (
          <>
            <Field
              label="Batch size (ml)"
              value={volume}
              onChangeText={setVolume}
              keyboardType="numeric"
              placeholder={String(chosen.volume_ml)}
            />
            <IngredientCard
              ingredients={scaleIngredients(chosen.ingredients, chosen.volume_ml, batchMl ?? chosen.volume_ml)}
              volumeMl={batchMl ?? chosen.volume_ml}
            />
          </>
        )}
        <Field
          label={chosen ? 'Recipe notes (optional)' : 'Recipe (optional)'}
          value={recipe}
          onChangeText={setRecipe}
          placeholder={chosen ? 'Used dark malt this time' : 'MEA 2%, 500 ml'}
        />
        <Choices<string>
          label="Sterilized in"
          value={recentRuns.some((r) => r.id === runId) ? runId : ''}
          onChange={setRunId}
          options={[{ value: '', label: 'Not recorded' }, ...recentRuns.map((r) => ({ value: r.id, label: r.code }))]}
        />
        <Button title="Log batch" onPress={addBatch} busy={busy === 'batch'} />
        </>
      )}

      <SectionTitle>Recent batches</SectionTitle>
      {batches.data?.length === 0 && <Muted>No batches yet.</Muted>}
      <View style={{ gap: space.sm }}>
        {batches.data?.map((b) => (
          <Card key={b.id}>
            <Text style={styles.codeSmall}>{b.code}</Text>
            <Muted>
              {[
                KIND_LABEL[b.kind],
                b.recipes ? recipeLabel(b.recipes) : null,
                b.volume_ml ? formatVolume(b.volume_ml) : null,
                b.recipe,
                labelDate(b.made_on),
                b.sterilization_runs?.code,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Muted>
          </Card>
        ))}
      </View>

      <SectionTitle>Recent runs</SectionTitle>
      {runs.data?.length === 0 && <Muted>No runs yet.</Muted>}
      <View style={{ gap: space.sm }}>
        {runs.data?.map((r) => (
          <Card key={r.id}>
            <Text style={styles.codeSmall}>{r.code}</Text>
            <Muted>
              {[
                METHOD_LABEL[r.method],
                r.psi ? `${r.psi} psi` : null,
                r.minutes ? `${r.minutes} min` : null,
                labelDate(r.run_on),
                r.notes,
              ]
                .filter(Boolean)
                .join(' · ')}
            </Muted>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
