import { type Ref, useId, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { useTheme } from '../theme';
import { Text } from './Text';

export interface TextFieldProps extends Omit<
  TextInputProps,
  'style' | 'placeholderTextColor' | 'accessibilityLabel'
> {
  readonly label: string;
  /** Localized validation message; when set, the field is announced and outlined as invalid. */
  readonly error?: string | null;
  /** Localized guidance shown under the field while there is no error. */
  readonly helperText?: string;
  readonly ref?: Ref<TextInput>;
}

/** Labelled text input; the visible label is also the spoken name. */
export function TextField({
  label,
  error,
  helperText,
  ref,
  editable = true,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const messageId = useId();
  const hasError = error !== undefined && error !== null && error !== '';
  const message = hasError ? error : helperText;
  const borderColor = hasError
    ? theme.colors.danger
    : focused
      ? theme.colors.primary
      : theme.colors.border;

  return (
    <View style={{ marginBottom: theme.spacing['4'] }}>
      <Text variant="label" style={{ marginBottom: theme.spacing['1'] }}>
        {label}
      </Text>
      <TextInput
        {...inputProps}
        ref={ref}
        editable={editable}
        accessibilityLabel={label}
        accessibilityHint={message}
        accessibilityState={{ disabled: !editable }}
        placeholderTextColor={theme.colors.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[
          theme.typography.body,
          styles.input,
          {
            minHeight: theme.minTouchTarget,
            paddingHorizontal: theme.spacing['3'],
            paddingVertical: theme.spacing['2'],
            borderRadius: theme.radius.sm,
            borderColor,
            borderWidth: hasError || focused ? 2 : 1,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            opacity: editable ? 1 : 0.6,
          },
        ]}
      />
      {message === undefined ? null : (
        <Text
          nativeID={messageId}
          variant="footnote"
          tone={hasError ? 'danger' : 'muted'}
          accessibilityLiveRegion={hasError ? 'polite' : 'none'}
          style={{ marginTop: theme.spacing['1'] }}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    textAlignVertical: 'center',
  },
});
