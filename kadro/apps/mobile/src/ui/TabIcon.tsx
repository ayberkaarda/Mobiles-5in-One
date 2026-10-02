import { type ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

export type TabIconName = 'matches' | 'teams' | 'openCalls' | 'venues' | 'profile';

export interface TabIconProps {
  readonly name: TabIconName;
  readonly color: ColorValue;
  readonly size: number;
}

const STROKE = {
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Line icons of the tab bar. Decorative: each tab is announced by its label. */
export function TabIcon({ name, color, size }: TabIconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {renderShape(name, color)}
    </Svg>
  );
}

function renderShape(name: TabIconName, color: ColorValue) {
  switch (name) {
    case 'matches':
      // Pitch: touchline rectangle, halfway line and centre circle.
      return (
        <>
          <Path d="M3 5h18v14H3z" stroke={color} {...STROKE} />
          <Path d="M12 5v14" stroke={color} {...STROKE} />
          <Circle cx="12" cy="12" r="3" stroke={color} {...STROKE} />
        </>
      );
    case 'teams':
      return (
        <>
          <Circle cx="9" cy="8" r="3" stroke={color} {...STROKE} />
          <Path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={color} {...STROKE} />
          <Circle cx="17" cy="9" r="2.5" stroke={color} {...STROKE} />
          <Path d="M16 14.2c2.8.4 5 2.8 5 5.8" stroke={color} {...STROKE} />
        </>
      );
    case 'openCalls':
      // A player with a plus: one more needed.
      return (
        <>
          <Circle cx="10" cy="8" r="3.5" stroke={color} {...STROKE} />
          <Path d="M3 20c0-3.9 3.1-7 7-7 1.4 0 2.7.4 3.8 1.1" stroke={color} {...STROKE} />
          <Path d="M18 14v6M15 17h6" stroke={color} {...STROKE} />
        </>
      );
    case 'venues':
      return (
        <>
          <Path
            d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"
            stroke={color}
            {...STROKE}
          />
          <Circle cx="12" cy="9.5" r="2.5" stroke={color} {...STROKE} />
        </>
      );
    case 'profile':
      return (
        <>
          <Circle cx="12" cy="8" r="4" stroke={color} {...STROKE} />
          <Path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" stroke={color} {...STROKE} />
        </>
      );
  }
}
