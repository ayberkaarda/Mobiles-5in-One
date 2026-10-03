import { act, fireEvent, render, screen } from '@testing-library/react-native/pure';
import { describe, expect, it } from 'vitest';

import trCommon from '../src/i18n/tr/common.json';
import {
  COLOR_SCHEME_STORAGE_KEY,
  type ColorPreference,
  createColorPreferenceStore,
  type PreferenceStorage,
  resolveColorScheme,
  theming,
  ThemeProvider,
  useColorPreference,
  useTheme,
} from '../src/theme';
import { ColorSchemeSetting, Text } from '../src/ui';
import AsyncStorage, { asyncStorageContents } from './support/async-storage';
import { deferred } from './support/deferred';
import { __setColorScheme } from './support/react-native';

/** In-memory storage for one test; `fail` makes reads or writes throw like a broken store. */
function memoryStorage(initial: Record<string, string> = {}, fail: 'read' | 'write' | null = null) {
  const items = new Map(Object.entries(initial));
  const storage: PreferenceStorage = {
    async getItem(key) {
      if (fail === 'read') {
        throw new Error('storage unavailable');
      }
      return items.get(key) ?? null;
    },
    async setItem(key, value) {
      if (fail === 'write') {
        throw new Error('storage unavailable');
      }
      items.set(key, value);
    },
  };
  return { storage, items };
}

describe('resolveColorScheme', () => {
  it.each([
    ['system', 'light', 'light'],
    ['system', 'dark', 'dark'],
    ['system', null, 'light'],
    ['system', 'unspecified', 'light'],
    ['light', 'dark', 'light'],
    ['light', 'light', 'light'],
    ['dark', 'light', 'dark'],
    ['dark', null, 'dark'],
  ] as const)('%s preference with a %s device renders %s', (preference, system, expected) => {
    expect(resolveColorScheme(preference, system)).toBe(expected);
  });
});

describe('colour preference storage', () => {
  it('uses the brand storage key and the Sistem / Açık / Koyu choices', () => {
    expect(COLOR_SCHEME_STORAGE_KEY).toBe('kadro.colorScheme');
    expect(theming.preferences).toEqual(['system', 'light', 'dark']);
    expect(trCommon.settings.colorScheme).toEqual(theming.labels);
  });

  it('starts on system and restores a stored choice', async () => {
    const { storage } = memoryStorage({ [COLOR_SCHEME_STORAGE_KEY]: 'dark' });
    const preference = createColorPreferenceStore(storage);
    expect(preference.store.getState()).toEqual({ preference: 'system', restored: false });
    await preference.restore();
    expect(preference.store.getState()).toEqual({ preference: 'dark', restored: true });
  });

  it('ignores an unknown stored value', async () => {
    const { storage } = memoryStorage({ [COLOR_SCHEME_STORAGE_KEY]: 'sepia' });
    const preference = createColorPreferenceStore(storage);
    await preference.restore();
    expect(preference.store.getState()).toEqual({ preference: 'system', restored: true });
  });

  it('follows the device when the storage cannot be read', async () => {
    const { storage } = memoryStorage({}, 'read');
    const preference = createColorPreferenceStore(storage);
    await preference.restore();
    expect(preference.store.getState()).toEqual({ preference: 'system', restored: true });
  });

  it('switches at once and remembers the choice', async () => {
    const { storage, items } = memoryStorage();
    const preference = createColorPreferenceStore(storage);
    await preference.choose('light');
    expect(preference.store.getState().preference).toBe('light');
    expect(items.get(COLOR_SCHEME_STORAGE_KEY)).toBe('light');
  });

  it('keeps the switch for this run when the write fails', async () => {
    const { storage } = memoryStorage({}, 'write');
    const preference = createColorPreferenceStore(storage);
    await expect(preference.choose('dark')).resolves.toBeUndefined();
    expect(preference.store.getState().preference).toBe('dark');
  });

  it('keeps a choice made while the stored value is still being read', async () => {
    const pending = deferred<string | null>();
    const storage: PreferenceStorage = {
      getItem: () => pending.promise,
      setItem: async () => undefined,
    };
    const preference = createColorPreferenceStore(storage);
    const restoring = preference.restore();
    await preference.choose('system');
    pending.resolve('dark');
    await restoring;
    expect(preference.store.getState()).toEqual({ preference: 'system', restored: true });
  });
});

describe('ThemeProvider with a stored preference', () => {
  function Probe() {
    const theme = useTheme();
    const { preference } = useColorPreference();
    return <Text testID="probe">{`${preference}:${theme.scheme}`}</Text>;
  }

  async function renderWith(initial: ColorPreference | null) {
    const { storage } = memoryStorage(
      initial === null ? {} : { [COLOR_SCHEME_STORAGE_KEY]: initial },
    );
    const preference = createColorPreferenceStore(storage);
    await preference.restore();
    await render(
      <ThemeProvider preference={preference}>
        <Probe />
      </ThemeProvider>,
    );
    return preference;
  }

  it('pins the dark scheme on a light device', async () => {
    __setColorScheme('light');
    await renderWith('dark');
    expect(screen.getByText('dark:dark')).toBeTruthy();
  });

  it('pins the light scheme and ignores device changes', async () => {
    __setColorScheme('dark');
    await renderWith('light');
    expect(screen.getByText('light:light')).toBeTruthy();
    await act(async () => {
      __setColorScheme('light');
    });
    await act(async () => {
      __setColorScheme('dark');
    });
    expect(screen.getByText('light:light')).toBeTruthy();
    __setColorScheme('light');
  });

  it('follows the device on system, and a forced scheme wins over both', async () => {
    __setColorScheme('dark');
    const preference = await renderWith(null);
    expect(screen.getByText('system:dark')).toBeTruthy();
    await act(async () => {
      await preference.choose('light');
    });
    expect(screen.getByText('light:light')).toBeTruthy();
    __setColorScheme('light');
  });

  it('honours the scheme prop used by tests and previews', async () => {
    const { storage } = memoryStorage({ [COLOR_SCHEME_STORAGE_KEY]: 'light' });
    const preference = createColorPreferenceStore(storage);
    await preference.restore();
    await render(
      <ThemeProvider preference={preference} scheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByText('light:dark')).toBeTruthy();
  });
});

describe('ColorSchemeSetting', () => {
  it('offers Sistem, Açık and Koyu as radios and switches the scheme of the whole tree', async () => {
    __setColorScheme('light');
    const preference = createColorPreferenceStore(AsyncStorage);
    await preference.restore();
    function SchemeText() {
      return <Text testID="scheme">{useTheme().scheme}</Text>;
    }
    await render(
      <ThemeProvider preference={preference}>
        <ColorSchemeSetting label="Görünüm" testID="scheme-setting" />
        <SchemeText />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('scheme-setting').props).toMatchObject({
      accessibilityRole: 'radiogroup',
      accessibilityLabel: 'Görünüm',
    });
    const system = screen.getByRole('radio', { name: 'Sistem' });
    expect(system.props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('radio', { name: 'Açık' })).toBeTruthy();

    await fireEvent.press(screen.getByTestId('scheme-setting-dark'));
    expect(screen.getByTestId('scheme').props.children).toBe('dark');
    expect(screen.getByRole('radio', { name: 'Koyu' }).props.accessibilityState).toMatchObject({
      checked: true,
    });
    await act(async () => undefined);
    expect(asyncStorageContents().get(COLOR_SCHEME_STORAGE_KEY)).toBe('dark');

    await fireEvent.press(screen.getByTestId('scheme-setting-system'));
    expect(screen.getByTestId('scheme').props.children).toBe('light');
  });
});
