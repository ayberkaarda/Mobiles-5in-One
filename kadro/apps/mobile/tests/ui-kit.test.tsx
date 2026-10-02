import { fireEvent, screen } from '@testing-library/react-native/pure';
import { StyleSheet } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { darkTheme, lightTheme, MIN_TOUCH_TARGET } from '../src/theme';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListItem,
  Screen,
  SkeletonList,
  Text,
  TextField,
} from '../src/ui';
import { renderWithProviders } from './support/render';

function flatStyle(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as Parameters<typeof StyleSheet.flatten>[0]) as Record<
    string,
    unknown
  >;
}

describe('Button', () => {
  it('is announced by its label, is at least 44 pt tall and calls onPress', async () => {
    const onPress = vi.fn();
    await renderWithProviders(<Button label="Kadroyu kur" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Kadroyu kur' });
    expect(flatStyle(button.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ignores presses and reports busy while loading', async () => {
    const onPress = vi.fn();
    await renderWithProviders(<Button label="Kaydet" onPress={onPress} loading />);
    const button = screen.getByRole('button', { name: 'Kaydet' });
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('ignores presses when disabled', async () => {
    const onPress = vi.fn();
    await renderWithProviders(<Button label="Gönder" onPress={onPress} disabled />);
    await fireEvent.press(screen.getByRole('button', { name: 'Gönder' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses the brand primary and on-primary colors', async () => {
    await renderWithProviders(<Button label="Katıl" onPress={() => undefined} />);
    const button = screen.getByRole('button', { name: 'Katıl' });
    expect(flatStyle(button.props.style).backgroundColor).toBe(lightTheme.colors.primary);
    expect(flatStyle(screen.getByText('Katıl').props.style).color).toBe(
      lightTheme.colors.onPrimary,
    );
  });
});

describe('TextField', () => {
  it('uses the visible label as the accessible name and forwards input', async () => {
    const onChangeText = vi.fn();
    await renderWithProviders(
      <TextField label="E-posta" value="" onChangeText={onChangeText} helperText="Giriş için" />,
    );
    const input = screen.getByLabelText('E-posta');
    expect(input.props.accessibilityHint).toBe('Giriş için');
    expect(flatStyle(input.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    await fireEvent.changeText(input, 'oyuncu@example.com');
    expect(onChangeText).toHaveBeenCalledWith('oyuncu@example.com');
  });

  it('announces the error politely and outlines the field in red', async () => {
    await renderWithProviders(<TextField label="Şifre" error="En az 10 karakter olmalı" />);
    const input = screen.getByLabelText('Şifre');
    expect(input.props.accessibilityHint).toBe('En az 10 karakter olmalı');
    expect(flatStyle(input.props.style).borderColor).toBe(lightTheme.colors.danger);
    const message = screen.getByText('En az 10 karakter olmalı');
    expect(message.props.accessibilityLiveRegion).toBe('polite');
  });
});

describe('Text', () => {
  it('announces title variants as headers and applies tabular digits on request', async () => {
    await renderWithProviders(
      <>
        <Text variant="title1">Maçlar</Text>
        <Text tabular>21:00</Text>
      </>,
    );
    expect(screen.getByRole('header', { name: 'Maçlar' })).toBeTruthy();
    expect(flatStyle(screen.getByText('21:00').props.style).fontVariant).toEqual(['tabular-nums']);
  });

  it('follows the dark scheme', async () => {
    await renderWithProviders(<Text>Gece maçı</Text>, { scheme: 'dark' });
    expect(flatStyle(screen.getByText('Gece maçı').props.style).color).toBe(darkTheme.colors.text);
  });
});

describe('ListItem', () => {
  it('is a single button announcing title, subtitle and meta when pressable', async () => {
    const onPress = vi.fn();
    await renderWithProviders(
      <ListItem title="Yıldızlar FK" subtitle="Kaptan · 9 oyuncu" meta="21:00" onPress={onPress} />,
    );
    const row = screen.getByRole('button', { name: 'Yıldızlar FK, Kaptan · 9 oyuncu, 21:00' });
    expect(flatStyle(row.props.style).minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is plain text without onPress', async () => {
    await renderWithProviders(<ListItem title="Moda Sahası" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('Moda Sahası')).toBeTruthy();
  });
});

describe('state views', () => {
  it('EmptyState shows its copy and action', async () => {
    const onPress = vi.fn();
    await renderWithProviders(
      <EmptyState
        title="Henüz bir takımın yok"
        message="Kadroyu kur."
        action={{ label: 'Takım kur', onPress }}
      />,
    );
    expect(screen.getByRole('header', { name: 'Henüz bir takımın yok' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Takım kur' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('ErrorState is an alert with a retry and the request reference', async () => {
    const retry = vi.fn();
    await renderWithProviders(
      <ErrorState
        title="Bir şeyler ters gitti"
        message="Bağlantı kurulamadı."
        requestId="req-123"
        referenceLabel="Hata kodu"
        retry={{ label: 'Tekrar dene', onPress: retry }}
      />,
    );
    expect(screen.getByRole('alert', { name: 'Bağlantı kurulamadı.' })).toBeTruthy();
    expect(screen.getByText('Hata kodu: req-123')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('SkeletonList is one busy progress element', async () => {
    await renderWithProviders(<SkeletonList accessibilityLabel="Yükleniyor" rows={3} />);
    const progress = screen.getByRole('progressbar', { name: 'Yükleniyor' });
    expect(progress.props.accessibilityState).toEqual({ busy: true });
  });

  it('Screen renders its title as a header over the themed background', async () => {
    await renderWithProviders(
      <Screen title="Profil" testID="screen">
        <Card>
          <Text>İçerik</Text>
        </Card>
      </Screen>,
    );
    expect(screen.getByRole('header', { name: 'Profil' })).toBeTruthy();
    expect(flatStyle(screen.getByTestId('screen').props.style).backgroundColor).toBe(
      lightTheme.colors.background,
    );
  });
});
