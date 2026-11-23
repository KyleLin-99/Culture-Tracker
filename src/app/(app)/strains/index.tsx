import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { useMembership } from '@/auth/AuthProvider';
import { createStrain, listStrains } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Card, ErrorText, Field, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { colors, font, space } from '@/ui/theme';

export default function Strains() {
  const { account_id } = useMembership();
  const strains = useData(listStrains);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return setError('Enter a strain name.');
    setBusy(true);
    setError(null);
    try {
      const s = await createStrain(account_id, name, species);
      setName('');
      setSpecies('');
      router.push({ pathname: '/strains/[id]', params: { id: s.id } });
    } catch (e) {
      const msg = errorMessage(e);
      setError(msg.includes('strains_name_uq') ? 'You already have a strain with that name.' : msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ErrorText>{strains.error}</ErrorText>
      {strains.data?.length === 0 && <Muted>No strains yet. Add your first one below.</Muted>}
      <View style={{ gap: space.sm }}>
        {strains.data?.map((s) => (
          <Card key={s.id} onPress={() => router.push({ pathname: '/strains/[id]', params: { id: s.id } })}>
            <Text style={styles.codeSmall}>{s.name}</Text>
            {s.species ? (
              <Text style={{ color: colors.muted, fontSize: font.small, fontStyle: 'italic' }}>{s.species}</Text>
            ) : null}
          </Card>
        ))}
      </View>

      <SectionTitle>New strain</SectionTitle>
      <Field label="Strain name" value={name} onChangeText={setName} placeholder="Blue Oyster" />
      <Field label="Species (optional)" value={species} onChangeText={setSpecies} placeholder="Pleurotus ostreatus" />
      <ErrorText>{error}</ErrorText>
      <Button title="Add strain" onPress={add} busy={busy} />
    </Screen>
  );
}
