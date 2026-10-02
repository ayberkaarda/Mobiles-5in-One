import { type ReactNode } from 'react';
import { type StyleProp, View, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '../theme';

export interface CardProps extends Omit<ViewProps, 'style'> {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

/** Surface container with the brand radius and a hairline outline. */
export function Card({ children, style, ...rest }: CardProps) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          padding: theme.spacing['4'],
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
