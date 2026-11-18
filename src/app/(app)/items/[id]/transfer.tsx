import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { labelDate, TRANSFER_MEDIA, todayLocal } from '@/domain/cultureCode';
import type { Item, Medium } from '@/domain/types';
import { createTransfers, getItem } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, Choices, ErrorText, Field, Muted, Screen, Stepper, styles } from '@/ui/components';
import { colors, space } from '@/ui/theme';

// "10 plates from S-2A": creates them all with consecutive codes, then shows
// the labels to write.
export default function Transfer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const parent = useData(() => getItem(id), [id]);
  const [count, setCount] = useState(1);
  const [medium, setMedium] = useState<Medium>('agar');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Item[] | null>(null);

  const p = parent.data;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      setCreated(await createTransfers({ parentId: id, count, medium, location, madeOn: todayLocal() }));
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
        <Button title="Done" onPress={() => router.back()} />
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
      <Field label="Location (optional)" value={location} onChangeText={setLocation} placeholder="Flow hood shelf 2" />
      <ErrorText>{error}</ErrorText>
      <Button title={`Create ${count}`} onPress={submit} busy={busy} disabled={!p} />
    </Screen>
  );
}
