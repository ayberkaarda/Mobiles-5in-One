import { fireEvent, screen } from '@testing-library/react-native/pure';
import { StyleSheet } from 'react-native';
import { beforeEach, describe, expect, it } from 'vitest';

import { BackLink } from '../src/navigation/BackLink';
import { initialsOf, withoutTag } from '../src/profile/initials';
import { TeamCrest } from '../src/teams/components';
import { darkTheme, lightTheme } from '../src/theme';
import { resetRouterDouble, routerCalls } from './support/expo-router';
import { renderWithProviders } from './support/render';

describe('names without the leading tag', () => {
  it('drops a leading bracketed tag only', () => {
    expect(withoutTag('[ÖRNEK] Deniz Kaptan')).toBe('Deniz Kaptan');
    expect(withoutTag('  [ÖRNEK]Moda Kartalları ')).toBe('Moda Kartalları');
    expect(withoutTag('Ece [10] Orta')).toBe('Ece [10] Orta');
    expect(withoutTag('Ali Kaleci')).toBe('Ali Kaleci');
  });

  it('makes avatar initials after the tag', () => {
    expect(initialsOf('[ÖRNEK] Deniz Kaptan')).toBe('DK');
    expect(initialsOf('[ÖRNEK] İlkay')).toBe('İ');
    expect(initialsOf('[ÖRNEK]')).toBe('');
    expect(initialsOf('ali kaleci')).toBe('AK');
  });

  it('shows the first letter of the team name on the crest, not the bracket', async () => {
    await renderWithProviders(
      <>
        <TeamCrest name="[ÖRNEK] Moda Kartalları" />
        <TeamCrest name="[ÖRNEK]" />
      </>,
    );
    const hidden = { includeHiddenElements: true };
    expect(screen.getByText('M', hidden)).toBeTruthy();
    expect(screen.getByText('?', hidden)).toBeTruthy();
    expect(screen.queryByText('[', hidden)).toBeNull();
  });
});

describe('back link', () => {
  beforeEach(() => {
    resetRouterDouble();
  });

  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ] as const)('is one link-coloured control in the %s scheme', async (scheme, theme) => {
    await renderWithProviders(<BackLink label="Geri" fallback="/takimlar" />, { scheme });
    const label = screen.getByText('‹ Geri');
    expect(StyleSheet.flatten(label.props.style).color).toBe(theme.colors.link);
    await fireEvent.press(screen.getByRole('button', { name: 'Geri' }));
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/takimlar' }]);
  });
});
