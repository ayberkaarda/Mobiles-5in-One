import { type ReactNode } from 'react';
import { type StyleProp, View, type ViewProps, type ViewStyle } from 'react-native';

import { useTheme } from '../theme';

export interface CardProps extends Omit<ViewProps, 'style'> {
  readonly children: ReactNode;
  /**
   * A floating layer (sheet, sticky action): `surfaceRaised`, with the brand shadow on light and
   * the raised step on dark. Plain cards use a hairline and no shadow.
   */
  readonly raised?: boolean;
  readonly style?: StyleProp<ViewStyle>;
}

/** Surface container: radius 12, 1 px `border` hairline, 16 pt padding. */
export function Card({ children, raised = false, style, ...rest }: CardProps) {
  const theme = useTheme();
  return (
    <View
      {...rest}
      style={[
        {
          backgroundColor: raised ? theme.colors.surfaceRaised : theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radius.md,
          padding: theme.spacing['4'],
        },
        raised ? theme.elevation : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}
