import { Text, View } from 'react-native';

import { todayLocal } from '@/domain/cultureCode';
import { sourceVsRest, sourceWindow, type StatsRow } from '@/domain/stats';
import type { ItemWithRefs } from '@/domain/types';
import { statsRows } from '@/lib/api';
import { useData } from '@/lib/useData';

import { Card, ErrorText, Muted, SectionTitle, styles } from './components';
import { ItemRow } from './ItemRow';
import { space } from './theme';

const pct = (r: number) => `${Math.round(r * 100)}%`;

/**
 * Contamination for plates from one batch or run next to the rest of the lab
 * (same dates), then every culture made from it.
 */
export function SourcePlates({
  madeOn,
  items,
  pick,
  emptyText = 'None yet. Pick this batch when you transfer onto it.',
}: {
  madeOn: string;
  items: ItemWithRefs[] | null;
  /** Which stats rows came from this source. */
  pick: (r: StatsRow) => boolean;
  /** Shown when nothing has been made from it yet. */
  emptyText?: string;
}) {
  const window = sourceWindow(madeOn, todayLocal());
  const rows = useData(() => statsRows(window.from, window.to), `${window.from}:${window.to}`);
  const cmp = rows.data ? sourceVsRest(rows.data, pick) : null;

  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>Contamination</SectionTitle>
      {rows.error && <ErrorText>{rows.error}</ErrorText>}
      {cmp && (
        <Card>
          {cmp.source.total === 0 ? (
            <Muted>No plates from this yet, or none scored (clean plates that were discarded don&apos;t count).</Muted>
          ) : (
            <>
              <Text style={styles.codeSmall}>
                {pct(cmp.source.rate)} · {cmp.source.contaminated} of {cmp.source.total} plates
              </Text>
              <Muted>
                {cmp.rest.total
                  ? `Rest of the lab, same dates: ${pct(cmp.rest.rate)} · ${cmp.rest.contaminated} of ${cmp.rest.total}`
                  : 'No other plates in the lab over the same dates to compare with.'}
              </Muted>
              {cmp.source.total < 10 && <Muted>Few plates so far, so treat the rate as a rough guide.</Muted>}
            </>
          )}
        </Card>
      )}

      <SectionTitle>{`Cultures made from it${items ? ` (${items.length})` : ''}`}</SectionTitle>
      {items?.length === 0 && <Muted>{emptyText}</Muted>}
      {items?.map((i) => (
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
  );
}
