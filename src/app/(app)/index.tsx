import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { useAuth, useMembership } from '@/auth/AuthProvider';
import { normalizeCode } from '@/domain/cultureCode';
import type { LookupRow } from '@/domain/types';
import { lookupCode, recentItems } from '@/lib/api';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, ErrorText, Muted, Screen, SectionTitle, styles } from '@/ui/components';
import { BackupsDue } from '@/ui/BackupsDue';
import { ItemRow } from '@/ui/ItemRow';
import { PendingWork } from '@/ui/PendingWork';
import { ROLE_LABEL } from '@/ui/roles';
import { SyncSummary } from '@/ui/SyncIndicator';
import { colors, font, space, TAP } from '@/ui/theme';

// Home: scan a label, or type its code, to jump to that culture.
export default function Home() {
  const membership = useMembership();
  const { signOut, memberships } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LookupRow[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const recent = useData(() => recentItems());

  // Search as you type, after a short pause.
  const q = normalizeCode(query);

  useEffect(() => {
    if (!q) return;
    const t = setTimeout(async () => {
      try {
        setSearchError(null);
        setResults(await lookupCode(q));
      } catch (e) {
        setSearchError(errorMessage(e));
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function openFirstExact() {
    const exact = results?.filter((r) => r.exact) ?? [];
    // Same code can exist in two strains; only jump when it's unambiguous.
    if (exact.length === 1) router.push({ pathname: '/items/[id]', params: { id: exact[0].id } });
  }

  return (
    <Screen>
      <TextInput
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={openFirstExact}
        placeholder="Culture code"
        placeholderTextColor={colors.muted}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
        style={{
          minHeight: TAP + 16,
          borderRadius: 14,
          borderWidth: 2,
          borderColor: colors.primary,
          backgroundColor: colors.card,
          paddingHorizontal: space.lg,
          fontSize: font.code,
          fontWeight: '700',
          color: colors.text,
        }}
      />
      <ErrorText>{searchError}</ErrorText>

      {/* Showing search results only while there's a query keeps stale results hidden. */}
      {q && results !== null ? (
        <View style={{ gap: space.sm }}>
          {results.length === 0 ? (
            <Muted>No culture with that code.</Muted>
          ) : (
            results.map((r) => (
              <ItemRow
                key={r.id}
                id={r.id}
                code={r.code}
                strainName={r.strain_name}
                medium={r.medium}
                status={r.status}
                madeOn={r.made_on}
                initials={r.initials}
              />
            ))
          )}
        </View>
      ) : (
        <>
          <Button title="Scan label" onPress={() => router.push('/scan')} />
          <PendingWork />
          <BackupsDue />
          <Button title="Strains and new origins" variant="secondary" onPress={() => router.push('/strains')} />
          <Button title="Batches and runs" variant="secondary" onPress={() => router.push('/batches')} />
          <Button title="Recipes" variant="secondary" onPress={() => router.push('/recipes')} />
          <Button title="Contamination trace" variant="secondary" onPress={() => router.push('/trace')} />
          <Button title="Stats" variant="secondary" onPress={() => router.push('/stats')} />

          <SectionTitle>Recent</SectionTitle>
          <ErrorText>{recent.error}</ErrorText>
          {recent.data?.length === 0 && (
            <Muted>Nothing yet. Add a strain, then its first spore print or clone.</Muted>
          )}
          <View style={{ gap: space.sm }}>
            {recent.data?.map((i) => (
              <ItemRow
                key={i.id}
                id={i.id}
                code={i.code}
                strainName={i.strains?.name}
                medium={i.medium}
                status={i.status}
                madeOn={i.made_on}
                initials={i.initials}
              />
            ))}
          </View>
        </>
      )}

      <View style={{ marginTop: space.xl, gap: space.sm }}>
        <Text style={styles.body} testID="current-lab">
          {membership.accounts?.name} · {membership.initials} · {ROLE_LABEL[membership.role]}
        </Text>
        <SyncSummary />
        <Button title="People" variant="secondary" onPress={() => router.push('/people')} />
        <Button title={memberships.length > 1 ? 'Switch lab' : 'Labs'} variant="secondary" onPress={() => router.push('/labs')} />
        {membership.role === 'owner' && (
          <Button title="Lab settings" variant="secondary" onPress={() => router.push('/settings')} />
        )}
        <Button title="Sign out" variant="secondary" onPress={signOut} />
      </View>
    </Screen>
  );
}
