import { Text, View } from 'react-native';

import { formatVolume } from '@/domain/recipes';
import type { Ingredient } from '@/domain/types';

import { Card, Muted, styles } from './components';
import { space } from './theme';

/** Ingredient amounts for one batch size, to read while weighing. */
export function IngredientCard({ ingredients, volumeMl }: { ingredients: Ingredient[]; volumeMl: number }) {
  return (
    <Card>
      <Muted>For {formatVolume(volumeMl)}</Muted>
      <View style={{ gap: space.xs }}>
        {ingredients.map((i, n) => (
          <Text key={`${i.name}-${n}`} style={styles.body} testID="ingredient">
            <Text style={{ fontWeight: '700' }}>
              {i.amount} {i.unit}
            </Text>{' '}
            {i.name}
          </Text>
        ))}
      </View>
    </Card>
  );
}
