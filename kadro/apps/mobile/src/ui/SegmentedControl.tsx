import { Pressable, StyleSheet, View } from 'react-native';

import { type ColorRole, type Theme, useTheme } from '../theme';
import { Text } from './Text';

/**
 * Fill of the selected segment. `neutral`: `inverse` / `onInverse` (settings choices). The RSVP
 * states use the brand state fills: `in` primary, `maybe` warning, `out` danger, each with its
 * on-colour, so the label always carries the meaning.
 */
export type SegmentTone = 'neutral' | 'in' | 'maybe' | 'out';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly tone?: SegmentTone;
  /** Spoken name when the visible label is not enough. */
  readonly accessibilityLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Spoken name of the group, e.g. "Görünüm". */
  readonly label: string;
  readonly options: readonly SegmentOption<T>[];
  /** The selected value; `null` when nothing is chosen yet. */
  readonly selected: T | null;
  readonly onSelect: (value: T) => void;
  /** Locked control: `fillMuted` ground, segments ignore presses. */
  readonly disabled?: boolean;
  /** Each segment gets `<testID>-<value>`. */
  readonly testID?: string;
}

const SELECTED: Readonly<Record<SegmentTone, [ColorRole, ColorRole]>> = {
  neutral: ['inverse', 'onInverse'],
  in: ['primary', 'onPrimary'],
  maybe: ['warning', 'onWarning'],
  out: ['danger', 'onDanger'],
};

function segmentColors(theme: Theme, tone: SegmentTone, checked: boolean, locked: boolean) {
  if (locked) {
    // The choice stays readable on the locked ground: `surface` with `text`, others muted.
    return checked
      ? { background: theme.colors.surface, foreground: theme.colors.text }
      : { background: 'transparent', foreground: theme.colors.textMuted };
  }
  if (!checked) {
    return { background: 'transparent', foreground: theme.colors.textMuted };
  }
  // eslint-disable-next-line security/detect-object-injection -- tone is a typed SegmentTone
  const [fill, on] = SELECTED[tone];
  // eslint-disable-next-line security/detect-object-injection -- typed ColorRole keys
  return { background: theme.colors[fill], foreground: theme.colors[on] };
}

/**
 * A single choice among two to four options (Sistem / Açık / Koyu, the RSVP control). Announced
 * as a radio group; each segment is a radio with its checked state; 44 pt high segments inside a
 * `borderStrong` outline.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  selected,
  onSelect,
  disabled = false,
  testID,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={[
        styles.group,
        {
          padding: 3,
          borderRadius: theme.radius.sm,
          borderWidth: 1,
          borderColor: theme.colors.borderStrong,
          backgroundColor: disabled ? theme.colors.fillMuted : theme.colors.surface,
        },
      ]}
    >
      {options.map((option) => {
        const checked = option.value === selected;
        const colors = segmentColors(theme, option.tone ?? 'neutral', checked, disabled);
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ checked, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!checked) {
                onSelect(option.value);
              }
            }}
            testID={testID === undefined ? undefined : `${testID}-${option.value}`}
            style={({ pressed }) => [
              styles.segment,
              {
                minHeight: theme.minTouchTarget,
                paddingHorizontal: theme.spacing['2'],
                borderRadius: theme.radius.sm - 2,
                backgroundColor:
                  pressed && !checked && !disabled ? theme.colors.pressed : colors.background,
              },
            ]}
          >
            <Text
              variant="label"
              align="center"
              numberOfLines={1}
              style={{ color: colors.foreground }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
