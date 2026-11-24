import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { labelDate, MEDIUM_LABEL } from '@/domain/cultureCode';
import { listStrains, strainTree } from '@/lib/api';
import { useData } from '@/lib/useData';

import { Button, Choices, Muted, styles } from './components';
import { colors, space } from './theme';

/**
 * Pick cultures to label: a strain, then a generation (or all), then tick
 * cultures. Only active ones are listed; those already chosen are marked.
 */
export function CulturePicker({ chosen, onAdd }: { chosen: string[]; onAdd: (ids: string[]) => void }) {
  const strains = useData(() => listStrains());
  const [strainId, setStrainId] = useState('');
  const tree = useData(() => (strainId ? strainTree(strainId) : Promise.resolve([])), strainId);
  const [gen, setGen] = useState('all');
  const [ticked, setTicked] = useState<string[]>([]);

  const active = useMemo(() => (tree.data ?? []).filter((r) => r.status === 'active'), [tree.data]);
  const gens = [...new Set(active.map((r) => r.generation))].sort((a, b) => a - b);
  const shown = active.filter((r) => gen === 'all' || r.generation === Number(gen));
  const toggle = (id: string) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  function pickStrain(id: string) {
    setStrainId(id);
    setGen('all');
    setTicked([]);
  }

  return (
    <View style={{ gap: space.sm }}>
      {strains.data?.length === 0 && <Muted>No strains yet.</Muted>}
      {!!strains.data?.length && (
        <Choices label="Strain" value={strainId} onChange={pickStrain} options={strains.data.map((s) => ({ value: s.id, label: s.name }))} />
      )}
      {strainId !== '' && tree.data && active.length === 0 && <Muted>No active cultures in this strain.</Muted>}
      {gens.length > 1 && (
        <Choices
          label="Generation"
          value={gen}
          onChange={(g) => {
            setGen(g);
            setTicked([]);
          }}
          options={[{ value: 'all', label: 'All' }, ...gens.map((g) => ({ value: String(g), label: g === 0 ? 'Origins' : `Gen ${g}` }))]}
        />
      )}
      {shown.length > 0 && (
        <>
          <View style={[styles.row, { justifyContent: 'space-between' }]}>
            <Muted>{`${shown.length} active`}</Muted>
            <Pressable
              accessibilityRole="button"
              onPress={() => setTicked(ticked.length === shown.length ? [] : shown.map((r) => r.id))}
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                {ticked.length === shown.length ? 'Clear' : 'Select all'}
              </Text>
            </Pressable>
          </View>
          {shown.map((r) => {
            const on = ticked.includes(r.id);
            const already = chosen.includes(r.id);
            return (
              <Pressable
                key={r.id}
                accessibilityRole="checkbox"
                aria-checked={on}
                accessibilityLabel={r.code}
                onPress={() => toggle(r.id)}
                style={[styles.card, { flexDirection: 'row', alignItems: 'center', gap: space.sm }, on && { borderColor: colors.primary }]}
              >
                <Text style={{ fontSize: 18, color: on ? colors.primary : colors.muted }}>{on ? '☑' : '☐'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.codeSmall}>{r.code}</Text>
                  <Muted>
                    {[MEDIUM_LABEL[r.medium], labelDate(r.made_on), r.initials, already ? 'already added' : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Muted>
                </View>
              </Pressable>
            );
          })}
          <Button
            title={ticked.length === 1 ? 'Add 1 culture' : `Add ${ticked.length} cultures`}
            disabled={!ticked.length}
            onPress={() => {
              onAdd(ticked);
              setTicked([]);
            }}
          />
        </>
      )}
    </View>
  );
}
