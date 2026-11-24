import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { labelDate } from '@/domain/cultureCode';
import {
  isSheet,
  type LabelContent,
  type LabelData,
  LABEL_SIZES,
  labelsHtml,
  type LabelSize,
  qrPayload,
  SHEET_LABELS,
  withCopies,
} from '@/domain/labels';
import { getItem } from '@/lib/api';
import { printHtml } from '@/lib/printLabels';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Choices, ErrorText, LinkText, Muted, Screen, SectionTitle, Stepper, styles } from '@/ui/components';
import { CulturePicker } from '@/ui/CulturePicker';
import { QrCode } from '@/ui/QrCode';
import { colors, space } from '@/ui/theme';

const SIZE_KEY = 'label-size';
const CONTENT_KEY = 'label-content';

type Copies = '1' | '2' | '5' | '10' | 'fill';

/**
 * Print labels for the cultures in ?ids=a,b,c (from a culture, a transfer or
 * backups), plus any picked here by strain and generation.
 */
export default function Labels() {
  const { ids = '' } = useLocalSearchParams<{ ids?: string }>();
  const idList = ids.split(',').filter(Boolean);
  const labels = useData(async (): Promise<LabelData[]> => {
    const items = await Promise.all(idList.map((id) => getItem(id)));
    return items.map((i) => ({
      id: i.id,
      code: i.code,
      strain: i.strains?.name ?? '',
      madeOn: i.made_on,
      initials: i.initials,
    }));
  }, ids);

  const setIds = (next: string[]) => router.setParams({ ids: [...new Set(next)].join(',') });

  const [size, setSize] = useState<LabelSize>('brother-29x90');
  const [content, setContent] = useState<LabelContent>('full');
  const [copies, setCopies] = useState<Copies>('1');
  const [startAt, setStartAt] = useState(1);
  const sheet = isSheet(size);
  const effectiveCopies = copies === 'fill' && !sheet ? '1' : copies;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remember the label stock between prints (just a convenience; fine if storage is unavailable).
  useEffect(() => {
    AsyncStorage.getItem(SIZE_KEY)
      .then((v) => {
        if (v && LABEL_SIZES.some((s) => s.value === v)) setSize(v as LabelSize);
      })
      .catch(() => {});
    AsyncStorage.getItem(CONTENT_KEY)
      .then((v) => {
        if (v === 'full' || v === 'qr') setContent(v);
      })
      .catch(() => {});
  }, []);
  function chooseContent(c: LabelContent) {
    setContent(c);
    AsyncStorage.setItem(CONTENT_KEY, c).catch(() => {});
  }
  function chooseSize(s: LabelSize) {
    setSize(s);
    AsyncStorage.setItem(SIZE_KEY, s).catch(() => {});
  }

  async function print() {
    if (!toPrint.length) return;
    setBusy(true);
    setError(null);
    try {
      await printHtml(labelsHtml(toPrint, size, { content, startAt: sheet ? startAt : 1 }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const toPrint = withCopies(labels.data ?? [], effectiveCopies === 'fill' ? 'fill' : Number(effectiveCopies), sheet ? startAt : 1);
  const n = toPrint.length;
  const perCulture = labels.data?.length ? n / labels.data.length : 1;
  const sheets = sheet ? Math.ceil((n + startAt - 1) / SHEET_LABELS) : 0;
  return (
    <Screen>
      <Choices<LabelSize>
        label="Label stock"
        value={size}
        onChange={chooseSize}
        options={LABEL_SIZES.map((s) => ({ value: s.value, label: s.label }))}
      />
      <Muted>{LABEL_SIZES.find((s) => s.value === size)?.hint}</Muted>
      <Choices<LabelContent>
        label="On each label"
        value={content}
        onChange={chooseContent}
        options={[
          { value: 'full', label: 'QR and details' },
          { value: 'qr', label: 'QR code only' },
        ]}
      />
      <Choices<Copies>
        label="Copies of each"
        value={effectiveCopies}
        onChange={setCopies}
        options={[
          { value: '1', label: '1' },
          { value: '2', label: '2' },
          { value: '5', label: '5' },
          { value: '10', label: '10' },
          ...(sheet ? [{ value: 'fill' as const, label: 'Fill the sheet' }] : []),
        ]}
      />
      {sheet && (
        <>
          <Stepper label="Start at label (for a part-used sheet)" value={startAt} onChange={setStartAt} min={1} max={SHEET_LABELS} />
          <Muted>Labels count across, left to right: 1–3 is the top row.</Muted>
        </>
      )}
      <ErrorText>{labels.error ?? error}</ErrorText>
      <Button
        title={n === 0 ? 'Print labels' : n === 1 ? 'Print label' : `Print ${n} labels`}
        busy={busy}
        disabled={!n}
        onPress={print}
      />
      {sheets > 1 && <Muted>{`That's ${sheets} sheets.`}</Muted>}

      {idList.length === 0 && <Muted>No cultures yet. Pick some below.</Muted>}
      <View style={{ gap: space.sm }}>
        {labels.data?.map((l) => (
          <View
            key={l.id}
            testID="label-preview"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              padding: space.sm,
              backgroundColor: '#fff',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 6,
            }}
          >
            <QrCode value={qrPayload(l.id)} size={72} />
            {content === 'full' ? (
              <View style={{ flex: 1 }}>
                <Text style={styles.codeSmall}>{l.code}</Text>
                <Text style={styles.body} numberOfLines={1}>
                  {l.strain}
                </Text>
                <Muted>
                  {labelDate(l.madeOn)} · {l.initials}
                </Muted>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <Muted>{`QR only (${l.code})`}</Muted>
              </View>
            )}
            <View style={{ alignItems: 'flex-end', gap: space.xs }}>
              {perCulture > 1 && <Muted>{`× ${perCulture}`}</Muted>}
              <LinkText title="Remove" onPress={() => setIds(idList.filter((x) => x !== l.id))} />
            </View>
          </View>
        ))}
      </View>

      <SectionTitle>Add cultures</SectionTitle>
      <CulturePicker chosen={idList} onAdd={(add) => setIds([...idList, ...add])} />
    </Screen>
  );
}
