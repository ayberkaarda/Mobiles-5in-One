import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// What the settings screen remembers between launches: the language
/// (null = the default, Turkish) and the theme mode.
@immutable
class StoredSettings {
  const new({this.languageCode, this.themeMode = ThemeMode.system});

  final String? languageCode;
  final ThemeMode themeMode;
}

/// Persistence of [StoredSettings]. No secret is kept here.
abstract interface class SettingsStore {
  Future<StoredSettings> read();
  Future<void> writeLanguage(String? languageCode);
  Future<void> writeThemeMode(ThemeMode mode);
}

/// [SettingsStore] over the platform keystore (`flutter_secure_storage`,
/// its own namespace, apart from the tokens). Used because it is already
/// part of the app; the values are plain preferences.
class SecureSettingsStore implements SettingsStore {
  new({FlutterSecureStorage? storage})
    : _storage =
          storage ??
          const FlutterSecureStorage(
            aOptions: AndroidOptions(storageNamespace: 'askida_settings'),
            iOptions: IOSOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  static const languageKey = 'askida.settings.language';
  static const themeKey = 'askida.settings.theme';

  final FlutterSecureStorage _storage;

  @override
  Future<StoredSettings> read() async {
    final language = await _storage.read(key: languageKey);
    final theme = await _storage.read(key: themeKey);
    return StoredSettings(
      languageCode: language,
      themeMode: ThemeMode.values.firstWhere(
        (mode) => mode.name == theme,
        orElse: () => ThemeMode.system,
      ),
    );
  }

  @override
  Future<void> writeLanguage(String? languageCode) => languageCode == null
      ? _storage.delete(key: languageKey)
      : _storage.write(key: languageKey, value: languageCode);

  @override
  Future<void> writeThemeMode(ThemeMode mode) =>
      _storage.write(key: themeKey, value: mode.name);
}

/// In-memory [SettingsStore] (tests, platforms without a keystore).
class InMemorySettingsStore implements SettingsStore {
  new([this.settings = const StoredSettings()]);

  StoredSettings settings;

  @override
  Future<StoredSettings> read() async => settings;

  @override
  Future<void> writeLanguage(String? languageCode) async => settings =
      StoredSettings(languageCode: languageCode, themeMode: settings.themeMode);

  @override
  Future<void> writeThemeMode(ThemeMode mode) async => settings =
      StoredSettings(languageCode: settings.languageCode, themeMode: mode);
}

final settingsStoreProvider = Provider<SettingsStore>(
  (ref) => SecureSettingsStore(),
);
