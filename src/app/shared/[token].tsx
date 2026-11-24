import { Stack, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import type { TreeRow } from '@/domain/types';
import { sharedLineage } from '@/lib/api';
import { useData } from '@/lib/useData';
import { ErrorText, Muted, Screen, SectionTitle } from '@/ui/components';
import { colors, font } from '@/ui/theme';
import { TreeList } from '@/ui/TreeList';

/** A shared strain lineage: opens signed out, read-only, until the link expires. */
export default function SharedLineagePage() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const shared = useData(() => sharedLineage(token), token);
  const d = shared.data;
  // TreeList's shape; codes are unique within a strain, so they stand in for ids.
  const rows: TreeRow[] = (d?.tree ?? []).map((r) => ({
    id: r.code, parent_id: r.parent_code, code: r.code, kind: r.kind as TreeRow['kind'], medium: r.medium,
    status: r.status, generation: r.generation, made_on: r.made_on, initials: '', depth: r.depth,
  }));

  return (
    <Screen>
      <Stack.Screen options={{ title: d ? `${d.strain.name} lineage` : 'Shared lineage' }} />
      <ErrorText>{shared.error}</ErrorText>
      {d && (
        <>
          <Text style={{ fontSize: font.title, fontWeight: '800', color: colors.text }}>{d.strain.name}</Text>
          {d.strain.species ? <Text style={{ fontSize: font.body, fontStyle: 'italic', color: colors.muted }}>{d.strain.species}</Text> : null}
          <SectionTitle>Family tree</SectionTitle>
          {rows.length ? <TreeList rows={rows} readOnly /> : <Muted>No cultures yet.</Muted>}
          <Muted>
            Shared from Culture Tracker. Read-only; this link works until {new Date(d.expires_at).toLocaleDateString()}.
          </Muted>
        </>
      )}
    </Screen>
  );
}
