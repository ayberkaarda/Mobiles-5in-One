import { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { type Edge, SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '../theme';
import { Text } from './Text';

export interface ScreenProps {
  readonly children: ReactNode;
  /** Screen heading, announced as a header. */
  readonly title?: string;
  /** Wraps the content in a ScrollView; lists bring their own scrolling and leave this off. */
  readonly scroll?: boolean;
  /** Safe-area edges to pad; tab screens leave the bottom to the tab bar. */
  readonly edges?: readonly Edge[];
  readonly testID?: string;
}

const DEFAULT_EDGES: readonly Edge[] = ['top', 'left', 'right'];

export function Screen({
  children,
  title,
  scroll = false,
  edges = DEFAULT_EDGES,
  testID,
}: ScreenProps) {
  const theme = useTheme();
  const heading =
    title === undefined ? null : (
      <Text
        variant="title1"
        style={{
          paddingHorizontal: theme.spacing['4'],
          paddingTop: theme.spacing['4'],
          paddingBottom: theme.spacing['3'],
        }}
      >
        {title}
      </Text>
    );
  return (
    <SafeAreaView
      edges={edges}
      testID={testID}
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
    >
      {scroll ? (
        <ScrollView contentContainerStyle={{ paddingBottom: theme.spacing['8'] }}>
          {heading}
          {children}
        </ScrollView>
      ) : (
        <View style={styles.fill}>
          {heading}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
