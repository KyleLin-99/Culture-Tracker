import { router, Stack, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

import { batchSummary, runSummary } from "@/domain/media";
import { batchesInRun, getRun, itemsOnBatches } from "@/lib/api";
import { useData } from "@/lib/useData";
import {
  Card,
  ErrorText,
  LinkText,
  Muted,
  Screen,
  SectionTitle,
  styles,
} from "@/ui/components";
import { SourcePlates } from "@/ui/SourcePlates";
import { space } from "@/ui/theme";

// One sterilization run: the batches that went through it, every culture made on
// those, and whether they contaminate more than the rest of the lab (a weak run).
export default function RunDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const run = useData(() => getRun(id), id);
  const batches = useData(() => batchesInRun(id), id);
  // 'loaded:' so a run with no batches still loads (as none) once its batches arrive.
  const batchKey = batches.data
    ? `loaded:${batches.data.map((b) => b.id).join(",")}`
    : "";
  const items = useData(
    () =>
      batches.data
        ? itemsOnBatches(batches.data.map((b) => b.id))
        : Promise.resolve(null),
    batchKey,
  );
  const r = run.data;

  return (
    <Screen>
      <Stack.Screen options={{ title: r?.code ?? "Run" }} />
      <LinkText
        title="‹ Batches and runs"
        onPress={() => router.dismissTo("/batches")}
      />
      <ErrorText>{run.error ?? batches.error ?? items.error}</ErrorText>
      {r && (
        <>
          <Card>
            <Text style={styles.codeSmall}>{r.code}</Text>
            <Muted>{runSummary(r)}</Muted>
            {r.notes ? <Muted>{r.notes}</Muted> : null}
          </Card>

          <SectionTitle>Batches in this run</SectionTitle>
          {batches.data?.length === 0 && (
            <Muted>No batches recorded for this run.</Muted>
          )}
          <View style={{ gap: space.sm }}>
            {batches.data?.map((b) => (
              <Card
                key={b.id}
                onPress={() =>
                  router.push({ pathname: "/batch/[id]", params: { id: b.id } })
                }
              >
                <Text style={styles.codeSmall}>{b.code}</Text>
                <Muted>{batchSummary(b, { withRun: false })}</Muted>
              </Card>
            ))}
          </View>

          <SourcePlates
            madeOn={r.run_on}
            items={items.data}
            pick={(row) => row.run_id === id}
            emptyText="None yet. Cultures show here once they're made on a batch from this run."
          />
        </>
      )}
    </Screen>
  );
}
