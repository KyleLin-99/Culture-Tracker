import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { labelDate } from '@/domain/cultureCode';
import { formatVolume, KIND_LABEL, recipeLabel, scaleIngredients } from '@/domain/recipes';
import { archiveRecipe, recipeVersions } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, ErrorText, Field, LinkText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { IngredientCard } from '@/ui/Ingredients';
import { space } from '@/ui/theme';

export default function RecipeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const versions = useData(() => recipeVersions(id), id);
  const [shownVersion, setShownVersion] = useState<number | null>(null);
  const [volume, setVolume] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const all = versions.data ?? [];
  const latest = all[0];
  const r = all.find((v) => v.version === shownVersion) ?? latest;
  if (!r) {
    return (
      <Screen>
        <ErrorText>{versions.error}</ErrorText>
      </Screen>
    );
  }
  const archived = !!latest.deleted_at;
  const target = Number(volume.replace(',', '.'));
  const scaled = volume.trim() && target > 0;

  async function archive() {
    setBusy(true);
    setError(null);
    try {
      await archiveRecipe(id);
      router.dismissTo('/recipes');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: latest.name }} />
      <LinkText title="‹ All recipes" onPress={() => router.dismissTo('/recipes')} />
      <Card>
        <Text style={styles.code}>{recipeLabel(r)}</Text>
        <Muted>
          {KIND_LABEL[r.kind]} · {formatVolume(r.volume_ml)} · saved {labelDate(r.created_at.slice(0, 10))}
          {r.version !== latest.version ? ' · older version' : ''}
          {archived ? ' · archived' : ''}
        </Muted>
      </Card>

      <SectionTitle>Ingredients</SectionTitle>
      <Field
        label="Batch size (ml)"
        value={volume}
        onChangeText={setVolume}
        keyboardType="numeric"
        placeholder={String(r.volume_ml)}
      />
      <IngredientCard
        ingredients={scaled ? scaleIngredients(r.ingredients, r.volume_ml, target) : r.ingredients}
        volumeMl={scaled ? target : r.volume_ml}
      />

      {r.steps ? (
        <>
          <SectionTitle>Steps</SectionTitle>
          <Card>
            <Text style={styles.body}>{r.steps}</Text>
          </Card>
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
      {!archived && (
        <View style={{ gap: space.sm }}>
          <Button
            title={`Edit (saves as v${latest.version + 1})`}
            onPress={() => router.push({ pathname: '/recipes/edit', params: { familyId: id } })}
          />
          {confirmArchive ? (
            <Card>
              <Muted>Archive {latest.name}? It won’t be offered for new batches. Batches already made keep it.</Muted>
              <Button title="Archive recipe" variant="danger" busy={busy} onPress={archive} />
              <Button title="Keep" variant="secondary" onPress={() => setConfirmArchive(false)} />
            </Card>
          ) : (
            <Button title="Archive" variant="secondary" onPress={() => setConfirmArchive(true)} />
          )}
        </View>
      )}

      {all.length > 1 && (
        <>
          <SectionTitle>Versions</SectionTitle>
          <View style={{ gap: space.sm }}>
            {all.map((v) => (
              <Card key={v.id} onPress={() => setShownVersion(v.version)}>
                <Text style={styles.body}>
                  {recipeLabel(v)}
                  {v.version === r.version ? ' (showing)' : ''}
                </Text>
                <Muted>
                  {formatVolume(v.volume_ml)} · saved {labelDate(v.created_at.slice(0, 10))}
                </Muted>
              </Card>
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}
