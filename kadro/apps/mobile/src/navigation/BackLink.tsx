import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { useTheme } from '../theme';
import { Text } from '../ui';

/**
 * The one back control of the pushed screens ("‹ Geri" in the `link` role, 44 pt tall): the
 * previous screen, else `fallback` when the screen was opened directly (deep link, cold start).
 */
export function BackLink({
  label,
  fallback,
}: {
  readonly label: string;
  readonly fallback: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
      testID="back"
      style={({ pressed }) => ({
        minHeight: theme.minTouchTarget,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: theme.layout.gutter,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Text tone="link" variant="label">
        {`‹ ${label}`}
      </Text>
    </Pressable>
  );
}
