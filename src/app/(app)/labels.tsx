import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { labelDate } from '@/domain/cultureCode';
import { LABEL_SIZES, type LabelData, labelsHtml, type LabelSize, qrPayload } from '@/domain/labels';
import { getItem } from '@/lib/api';
import { printHtml } from '@/lib/printLabels';
import { errorMessage } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { Button, Choices, ErrorText, Muted, Screen, styles } from '@/ui/components';
import { QrCode } from '@/ui/QrCode';
import { colors, space } from '@/ui/theme';

const SIZE_KEY = 'label-size';

/** Print labels for the cultures in ?ids=a,b,c (from a culture, a transfer or backups). */
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

  const [size, setSize] = useState<LabelSize>('brother-29x90');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Remember the label stock between prints (just a convenience; fine if storage is unavailable).
  useEffect(() => {
    AsyncStorage.getItem(SIZE_KEY)
      .then((v) => {
        if (v && LABEL_SIZES.some((s) => s.value === v)) setSize(v as LabelSize);
      })
      .catch(() => {});
  }, []);
  function chooseSize(s: LabelSize) {
    setSize(s);
    AsyncStorage.setItem(SIZE_KEY, s).catch(() => {});
  }

  async function print() {
    if (!labels.data?.length) return;
    setBusy(true);
    setError(null);
    try {
      await printHtml(labelsHtml(labels.data, size));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const n = labels.data?.length ?? idList.length;
  return (
    <Screen>
      <Choices<LabelSize>
        label="Label stock"
        value={size}
        onChange={chooseSize}
        options={LABEL_SIZES.map((s) => ({ value: s.value, label: s.label }))}
      />
      <Muted>{LABEL_SIZES.find((s) => s.value === size)?.hint}</Muted>
      <ErrorText>{labels.error ?? error}</ErrorText>
      <Button title={n === 1 ? 'Print label' : `Print ${n} labels`} busy={busy} disabled={!labels.data?.length} onPress={print} />

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
            <View style={{ flex: 1 }}>
              <Text style={styles.codeSmall}>{l.code}</Text>
              <Text style={styles.body} numberOfLines={1}>
                {l.strain}
              </Text>
              <Muted>
                {labelDate(l.madeOn)} · {l.initials}
              </Muted>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}
