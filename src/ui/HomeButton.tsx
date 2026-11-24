import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { colors, font } from './theme';

/** Header button on every screen but home: back to the start in one tap, however deep you are. */
export function HomeButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Home"
      onPress={() => router.dismissTo('/')}
      hitSlop={10}
      style={({ pressed }) => [{ paddingHorizontal: 10, paddingVertical: 6 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={{ color: colors.primary, fontSize: font.body, fontWeight: '600' }}>Home</Text>
    </Pressable>
  );
}
