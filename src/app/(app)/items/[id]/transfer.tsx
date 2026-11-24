import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { labelDate, TRANSFER_MEDIA, todayLocal } from '@/domain/cultureCode';
import { batchKindFor } from '@/domain/trace';
import type { Item, Medium } from '@/domain/types';
import { createTransfers, getItem, listBatches } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, Field, Muted, Screen, Stepper, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

// "10 plates from S-2A": creates them all with consecutive codes, then shows
// the labels to write.
export default function Transfer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const parent = useData(() => getItem(id), id);
  const [count, setCount] = useState(1);
  const [medium, setMedium] = useState<Medium>('agar');
  const [location, setLocation] = useState('');
  const batches = useData(() => listBatches(null, 30));
  const [batchId, setBatchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Item[] | null>(null);

  const p = parent.data;

  // Recent batches that fit the medium; '' = no batch recorded.
  const kind = batchKindFor(medium);
  const fitting = (batches.data ?? []).filter((b) => !kind || b.kind === kind).slice(0, 6);
  const batchOptions = [
    { value: '', label: 'No batch' },
    ...fitting.map((b) => ({
      value: b.id,
      label: b.sterilization_runs?.code ? `${b.code} · ${b.sterilization_runs.code}` : b.code,
    })),
  ];
  const chosenBatch = fitting.some((b) => b.id === batchId) ? batchId : '';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setCreated(
        await createTransfers({ parentId: id, count, medium, location, madeOn: todayLocal(), mediaBatchId: chosenBatch || null }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (created && p) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Write these labels' }} />
        <Text style={styles.body}>
          {created.length} new {created.length === 1 ? 'culture' : 'cultures'} from {p.code}:
        </Text>
        <View style={{ gap: space.sm }}>
          {created.map((c) => (
            <Card key={c.id}>
              <Text style={styles.code}>{c.code}</Text>
              <Text style={styles.body}>
                {p.strains?.name} · {labelDate(c.made_on)} · {c.initials}
              </Text>
            </Card>
          ))}
        </View>
        <Button
          title={created.length === 1 ? 'Print label' : `Print ${created.length} labels`}
          onPress={() => router.push({ pathname: '/labels', params: { ids: created.map((c) => c.id).join(',') } })}
        />
        <Button title="Done" variant="secondary" onPress={() => router.back()} />
        <Button
          title="Transfer more"
          variant="secondary"
          onPress={() => {
            setCreated(null);
            setCount(1);
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: p ? `Transfer from ${p.code}` : 'Transfer' }} />
      <ErrorText>{parent.error}</ErrorText>
      {p && (
        <Card>
          <Muted>Parent</Muted>
          <Text style={styles.codeSmall}>{p.code}</Text>
          <Text style={{ color: colors.muted }}>{p.strains?.name}</Text>
        </Card>
      )}
      <Stepper label="How many" value={count} onChange={setCount} min={1} max={100} />
      <Choices<Medium> label="Onto" value={medium} onChange={setMedium} options={TRANSFER_MEDIA} />
      <Choices<string> label="Media batch" value={chosenBatch} onChange={setBatchId} options={batchOptions} />
      {fitting.length === 0 && (
        <Muted>
          No {kind === 'lc' ? 'LC ' : kind === 'agar' ? 'agar ' : ''}batches logged yet. Log them under Batches and runs
          so the contamination trace can compare them.
        </Muted>
      )}
      <Field label="Location (optional)" value={location} onChangeText={setLocation} placeholder="Flow hood shelf 2" />
      <ErrorText>{error}</ErrorText>
      <Button title={`Create ${count}`} onPress={submit} busy={busy} disabled={!p} />
    </Screen>
  );
}
