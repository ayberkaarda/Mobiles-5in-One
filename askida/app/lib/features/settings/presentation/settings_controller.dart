import 'dart:async';

import 'package:askida/core/locale/app_locale.dart';
import 'package:askida/core/push/push_message.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/settings/data/settings_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Theme chosen in settings: system (default), light or dark.
class ThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() => ThemeMode.system;

  // A setter would read oddly at call sites (`notifier.mode = x`).
  // ignore: use_setters_to_change_properties
  void set(ThemeMode mode) => state = mode;
}

final themeModeProvider = NotifierProvider<ThemeModeController, ThemeMode>(
  ThemeModeController.new,
);

/// Languages the app offers; null = the default (Turkish).
const List<Locale> settingsLanguages = [Locale('tr'), Locale('en')];

/// Applies and remembers the language and theme choices.
class SettingsActions {
  new(this._ref);

  final Ref _ref;

  SettingsStore get _store => _ref.read(settingsStoreProvider);

  /// Loads the remembered choices at launch. A missing keystore leaves the
  /// defaults in place.
  Future<void> restore() async {
    try {
      final stored = await _store.read();
      final code = stored.languageCode;
      if (code != null &&
          settingsLanguages.any((l) => l.languageCode == code)) {
        _ref.read(appLocaleProvider.notifier).set(Locale(code));
      }
      _ref.read(themeModeProvider.notifier).set(stored.themeMode);
    } on Object {
      // Defaults stay.
    }
  }

  Future<void> setLanguage(Locale? locale) async {
    _ref.read(appLocaleProvider.notifier).set(locale);
    try {
      await _store.writeLanguage(locale?.languageCode);
    } on Object {
      // The choice holds for this session.
    }
  }

  Future<void> setThemeMode(ThemeMode mode) async {
    _ref.read(themeModeProvider.notifier).set(mode);
    try {
      await _store.writeThemeMode(mode);
    } on Object {
      // The choice holds for this session.
    }
  }
}

final settingsActionsProvider = Provider<SettingsActions>(SettingsActions.new);

/// Where push stands for this install.
enum PushRegistration {
  /// No transport (no Firebase configuration in this build) or no
  /// permission: there is no token and nothing is registered.
  unavailable,

  /// A token exists but nobody is signed in (registration waits).
  waitingForAccount,

  /// The token is registered for the signed-in account.
  registered,

  /// The token could not be registered (it is retried at the next sign-in
  /// or launch).
  failed,
}

/// Push wiring (ADR-0004): `init()` once, register the token with the
/// account when a token exists and someone is signed in, and open the
/// screen of a tapped notification. Tokens are never logged.
class PushController extends Notifier<PushRegistration> {
  bool _started = false;
  String? _registeredFor;
  StreamSubscription<PushMessage>? _messages;

  @override
  PushRegistration build() {
    ref.onDispose(() => unawaited(_messages?.cancel()));
    return PushRegistration.unavailable;
  }

  /// Starts the transport and listens for opened notifications; [open]
  /// receives them (the app routes them with `openPush`).
  Future<void> start(void Function(PushMessage message) open) async {
    if (_started) return;
    _started = true;
    final push = ref.read(pushServiceProvider);
    try {
      await push.init();
    } on Object {
      state = PushRegistration.unavailable;
      return;
    }
    _messages = push.onMessage.listen(open, onError: (Object _) {});
    await sync();
  }

  /// Registers the token for the signed-in user when needed.
  Future<void> sync() async {
    final token = ref.read(pushServiceProvider).token;
    if (token == null || token.isEmpty) {
      state = PushRegistration.unavailable;
      return;
    }
    final user = ref.read(sessionProvider).user;
    if (user == null) {
      _registeredFor = null;
      state = PushRegistration.waitingForAccount;
      return;
    }
    if (_registeredFor == user.id && state == PushRegistration.registered) {
      return;
    }
    try {
      await ref
          .read(pushRepositoryProvider)
          .registerToken(ref.read(devicePlatformProvider), token);
      _registeredFor = user.id;
      state = PushRegistration.registered;
    } on ApiProblem {
      state = PushRegistration.failed;
    }
  }
}

final pushControllerProvider =
    NotifierProvider<PushController, PushRegistration>(PushController.new);
