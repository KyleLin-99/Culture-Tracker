import { Text } from 'react-native';

import { formatVersion, getVersionInfo } from '@/lib/version';
import { Muted, Screen, SectionTitle, styles } from '@/ui/components';

/** Which version is running, so a tester can say exactly what they have. */
export default function About() {
  const info = getVersionInfo();
  return (
    <Screen>
      <SectionTitle>About Culture Tracker</SectionTitle>
      <Text style={styles.body} testID="app-version">
        {formatVersion(info)}
      </Text>
      <Muted>{info.isUpdate ? 'Running an over-the-air update.' : 'Running the version installed from the store.'}</Muted>
    </Screen>
  );
}
