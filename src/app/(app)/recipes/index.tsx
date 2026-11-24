import { router } from 'expo-router';
import { Text, View } from 'react-native';

import { useCanWrite } from '@/auth/AuthProvider';
import { formatVolume, KIND_LABEL, recipeLabel } from '@/domain/recipes';
import { listRecipes } from '@/lib/api';
import { useData } from '@/lib/useData';
import { Button, Card, ErrorText, Muted, Screen, styles } from '@/ui/components';
import { space } from '@/ui/theme';

// Saved recipes. Pick one when logging a media batch so the batch records the
// exact version and the contamination trace can compare recipes.
export default function Recipes() {
  const canWrite = useCanWrite();
  const recipes = useData(() => listRecipes());

  return (
    <Screen>
      {canWrite && <Button title="New recipe" onPress={() => router.push('/recipes/edit')} />}
      <ErrorText>{recipes.error}</ErrorText>
      {recipes.data?.length === 0 && (
        <Muted>No recipes yet. Save your agar and liquid-culture recipes once, then pick them when you log a batch.</Muted>
      )}
      <View style={{ gap: space.sm }}>
        {recipes.data?.map((r) => (
          <Card key={r.family_id} onPress={() => router.push({ pathname: '/recipes/[id]', params: { id: r.family_id } })}>
            <Text style={styles.codeSmall}>{recipeLabel(r)}</Text>
            <Muted>
              {KIND_LABEL[r.kind]} · {formatVolume(r.volume_ml)} · {r.ingredients.length} ingredient
              {r.ingredients.length === 1 ? '' : 's'}
            </Muted>
          </Card>
        ))}
      </View>
    </Screen>
  );
}
