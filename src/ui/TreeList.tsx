import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { labelDate, MEDIUM_LABEL, STATUS_LABEL } from '@/domain/cultureCode';
import type { TreeRow } from '@/domain/types';

import { colors, font, space, statusColor } from './theme';

/**
 * A family tree as an indented list. Contaminated branches show in red.
 * `baseDepth` shifts the indent so the shallowest row sits at the left edge.
 */
export function TreeList({ rows, highlightId }: { rows: TreeRow[]; highlightId?: string }) {
  if (rows.length === 0) return null;
  const base = Math.min(...rows.map((r) => r.depth));
  return (
    <View style={{ borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}>
      {rows.map((r, i) => {
        const c = statusColor[r.status];
        const highlighted = r.id === highlightId;
        return (
          <Pressable
            key={r.id}
            testID={`tree-row-${r.code}`}
            onPress={() => router.push({ pathname: '/items/[id]', params: { id: r.id } })}
            style={({ pressed }) => ({
              minHeight: 52,
              justifyContent: 'center',
              paddingVertical: space.sm,
              paddingRight: space.md,
              paddingLeft: space.md + (r.depth - base) * 18,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: colors.border,
              backgroundColor: highlighted ? '#EEF5EF' : pressed ? '#F1F3EF' : 'transparent',
            })}
          >
            <Text
              style={{
                fontSize: font.body,
                fontWeight: highlighted ? '800' : '700',
                color: r.status === 'active' ? colors.text : c.fg,
                textDecorationLine: r.status === 'discarded' ? 'line-through' : 'none',
              }}
            >
              {r.code}
              {r.status !== 'active' ? `  · ${STATUS_LABEL[r.status]}` : ''}
            </Text>
            <Text style={{ fontSize: font.small, color: colors.muted }}>
              {MEDIUM_LABEL[r.medium]} · {labelDate(r.made_on)} · {r.initials}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
