import { type ColorPreference, COLOR_PREFERENCES, theming, useColorPreference } from '../theme';
import { SegmentedControl } from './SegmentedControl';

export interface ColorSchemeSettingProps {
  /** Spoken name of the group ("Görünüm"). */
  readonly label: string;
  /** Option labels; the brand's Turkish labels (Sistem, Açık, Koyu) by default. */
  readonly labels?: Readonly<Record<ColorPreference, string>>;
  readonly testID?: string;
}

/**
 * The Sistem / Açık / Koyu choice for Ayarlar, wired to the stored preference: the scheme
 * switches at once and is remembered on the device. Segments: `<testID>-system|light|dark`.
 */
export function ColorSchemeSetting({
  label,
  labels = theming.labels,
  testID,
}: ColorSchemeSettingProps) {
  const { preference, choose } = useColorPreference();
  return (
    <SegmentedControl<ColorPreference>
      label={label}
      // eslint-disable-next-line security/detect-object-injection -- typed ColorPreference keys
      options={COLOR_PREFERENCES.map((value) => ({ value, label: labels[value] }))}
      selected={preference}
      onSelect={choose}
      testID={testID}
    />
  );
}
