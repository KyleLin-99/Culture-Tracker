import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { ORIGIN_TYPES } from '@/domain/cultureCode';
import type { Medium } from '@/domain/types';
import { createOrigin, getStrain, strainTree } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Choices, ErrorText, Field, Muted, Screen, SectionTitle } from '@/ui/components';
import { colors, font } from '@/ui/theme';
import { TreeList } from '@/ui/TreeList';

type OriginChoice = 'S' | 'W' | 'C' | 'SOURCE';

const SOURCE_MEDIA: { value: Medium; label: string }[] = [
  { value: 'culture', label: 'Culture / plate' },
  { value: 'spore_syringe', label: 'Spore syringe' },
  { value: 'lc', label: 'LC syringe' },
  { value: 'swab', label: 'Swab' },
];

export default function StrainDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { account_id } = useMembership();
  const strain = useData(() => getStrain(id), id);
  const tree = useData(() => strainTree(id), id);

  const [choice, setChoice] = useState<OriginChoice>('S');
  const [sourceInitials, setSourceInitials] = useState('');
  const [sourceMedium, setSourceMedium] = useState<Medium>('culture');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addOrigin() {
    let prefix: string;
    let medium: Medium;
    if (choice === 'SOURCE') {
      if (!/^[A-Z]{1,6}$/.test(sourceInitials)) return setError('Source initials are 1–6 letters, e.g. TBG.');
      prefix = sourceInitials;
      medium = sourceMedium;
    } else {
      const t = ORIGIN_TYPES.find((o) => o.prefix === choice)!;
      prefix = t.prefix;
      medium = t.medium;
    }
    setBusy(true);
    setError(null);
    try {
      const item = await createOrigin({ accountId: account_id, strainId: id, prefix, medium });
      router.push({ pathname: '/items/[id]', params: { id: item.id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: strain.data?.name ?? 'Strain' }} />
      {strain.data?.species ? (
        <Text style={{ fontSize: font.body, color: colors.muted, fontStyle: 'italic' }}>{strain.data.species}</Text>
      ) : null}
      <ErrorText>{strain.error ?? tree.error}</ErrorText>

      <SectionTitle>Family tree</SectionTitle>
      {tree.data?.length === 0 ? (
        <Muted>No origins yet. Add the spore print, clone or vendor culture this strain started from.</Muted>
      ) : (
        <TreeList rows={tree.data ?? []} />
      )}

      <SectionTitle>New origin</SectionTitle>
      <Choices<OriginChoice>
        label="Where it came from"
        value={choice}
        onChange={setChoice}
        options={[
          { value: 'S', label: 'Spore print (S)' },
          { value: 'W', label: 'Wild clone (W)' },
          { value: 'C', label: 'Clone of my fruit (C)' },
          { value: 'SOURCE', label: 'Person or company' },
        ]}
      />
      {choice === 'SOURCE' && (
        <>
          <Field
            label="Their initials"
            value={sourceInitials}
            onChangeText={(t) => setSourceInitials(t.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6))}
            autoCapitalize="characters"
            placeholder="TBG"
          />
          <Choices<Medium> label="What you received" value={sourceMedium} onChange={setSourceMedium} options={SOURCE_MEDIA} />
        </>
      )}
      <Muted>The first one gets no number (S). Later ones in this strain get 2, 3… (S2, S3).</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Add origin" onPress={addOrigin} busy={busy} />
    </Screen>
  );
}
