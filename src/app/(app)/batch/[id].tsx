import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import { batchSummary } from '@/domain/media';
import { recipeLabel, scaleIngredients } from '@/domain/recipes';
import { getBatch, itemsOnBatches, recipeVersions } from '@/lib/api';
import { useData } from '@/lib/useData';
import { Card, ErrorText, LinkText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { IngredientCard } from '@/ui/Ingredients';
import { SourcePlates } from '@/ui/SourcePlates';

// One media batch: what was mixed, where it was sterilized, every culture made
// on it, and whether those contaminate more than the rest of the lab.
export default function BatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const batch = useData(() => getBatch(id), id);
  const items = useData(() => itemsOnBatches([id]), id);
  const familyId = batch.data?.recipes?.family_id ?? '';
  const versions = useData(() => (familyId ? recipeVersions(familyId) : Promise.resolve([])), familyId);
  const recipe = versions.data?.find((r) => r.id === batch.data?.recipe_id) ?? null;
  const b = batch.data;

  return (
    <Screen>
      <Stack.Screen options={{ title: b?.code ?? 'Batch' }} />
      <LinkText title="‹ Batches and runs" onPress={() => router.dismissTo('/batches')} />
      <ErrorText>{batch.error ?? items.error}</ErrorText>
      {b && (
        <>
          <Card>
            <Text style={styles.codeSmall}>{b.code}</Text>
            <Muted>{batchSummary(b, { withRun: false })}</Muted>
            {b.notes ? <Muted>{b.notes}</Muted> : null}
          </Card>

          <SectionTitle>Sterilized in</SectionTitle>
          {b.sterilization_run_id ? (
            <LinkText
              title={b.sterilization_runs?.code ?? 'Run'}
              onPress={() => router.push({ pathname: '/run/[id]', params: { id: b.sterilization_run_id! } })}
            />
          ) : (
            <Muted>Not recorded.</Muted>
          )}

          {b.recipes && (
            <>
              <SectionTitle>Recipe</SectionTitle>
              {familyId ? (
                <LinkText
                  title={recipeLabel(b.recipes)}
                  onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: familyId } })}
                />
              ) : (
                <Muted>{recipeLabel(b.recipes)}</Muted>
              )}
              {recipe && (
                <IngredientCard
                  ingredients={scaleIngredients(recipe.ingredients, recipe.volume_ml, b.volume_ml ?? recipe.volume_ml)}
                  volumeMl={b.volume_ml ?? recipe.volume_ml}
                />
              )}
            </>
          )}

          <SourcePlates madeOn={b.made_on} items={items.data} pick={(r) => r.batch_id === id} />
        </>
      )}
    </Screen>
  );
}
