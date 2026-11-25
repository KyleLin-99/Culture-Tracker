import { Text } from 'react-native';

import { adminAuditLog } from '@/lib/api';
import { useData } from '@/lib/useData';
import { Card, ErrorText, Muted, Screen, styles } from '@/ui/components';

/** Every change made in the back office: who, what, to whom. */
export default function Audit() {
  const log = useData(() => adminAuditLog(200));
  return (
    <Screen>
      <ErrorText>{log.error}</ErrorText>
      {log.data?.length === 0 && <Muted>Nothing yet.</Muted>}
      {log.data?.map((a) => (
        <Card key={a.id}>
          <Text style={styles.body} testID="audit-row">
            {a.action}
            {a.target_email ? ` · ${a.target_email}` : ''}
          </Text>
          <Muted>
            {a.created_at.slice(0, 16).replace('T', ' ')} · {a.admin_email ?? 'unknown'} · {JSON.stringify(a.detail)}
          </Muted>
        </Card>
      ))}
    </Screen>
  );
}
