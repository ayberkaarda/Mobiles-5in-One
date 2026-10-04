import 'dart:async';

import 'package:askida/core/locale/app_locale.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/features/settings/presentation/settings_controller.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// `/settings`: account (sign-in, sign-out, deletion), language, theme and
/// the push state.
class SettingsScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _signingOut = false;

  void _close() =>
      context.canPop() ? context.pop() : context.go(AppMode.donor.path);

  Future<void> _signOut() async {
    setState(() => _signingOut = true);
    try {
      await ref.read(authRepositoryProvider).logout();
    } on Object {
      // The local token is gone either way (the repository clears it).
    }
    if (!mounted) return;
    setState(() => _signingOut = false);
    ScaffoldMessenger.maybeOf(context)
        ?.showSnackBar(SnackBar(content: Text(context.l10n.settingsSignedOut)));
    context.go(AppMode.donor.path);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final session = ref.watch(sessionProvider);
    final user = session.user;
    final locale = ref.watch(appLocaleProvider);
    final themeMode = ref.watch(themeModeProvider);
    final push = ref.watch(pushControllerProvider);
    final actions = ref.read(settingsActionsProvider);
    final language = locale?.languageCode ?? 'tr';

    Widget section(String title) => Padding(
      padding: const EdgeInsets.only(
        top: AskidaSpacing.s6,
        bottom: AskidaSpacing.s2,
      ),
      child: Semantics(
        header: true,
        child: Text(title, style: theme.textTheme.titleMedium),
      ),
    );

    return FormScreen(
      title: l10n.settingsTitle,
      onBack: _close,
      children: [
        section(l10n.settingsAccountSection),
        if (session.isSignedIn && user != null) ...[
          Text(user.name, style: theme.textTheme.bodyLarge),
          Text(
            user.email,
            style: theme.textTheme.bodyMedium?.copyWith(color: c.textMuted),
          ),
          formGap,
          BusyButton(
            key: const ValueKey('settings-signout'),
            label: l10n.settingsSignOut,
            tonal: true,
            busy: _signingOut,
            onPressed: () => unawaited(_signOut()),
          ),
          formGapSmall,
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(
              key: const ValueKey('settings-delete'),
              onPressed: _signingOut
                  ? null
                  : () => context.push(SettingsPaths.deleteAccount),
              style: TextButton.styleFrom(foregroundColor: c.dangerText),
              child: Text(l10n.settingsDeleteAccount),
            ),
          ),
        ] else ...[
          Text(l10n.settingsSignedOutBody, style: theme.textTheme.bodyMedium),
          formGapSmall,
          BusyButton(
            key: const ValueKey('settings-signin'),
            label: l10n.authSignInAction,
            tonal: true,
            onPressed: () =>
                context.push(AuthPaths.signIn(from: AppPaths.settings)),
          ),
        ],
        section(l10n.settingsLanguageSection),
        RadioGroup<String>(
          groupValue: language,
          onChanged: (code) {
            if (code == null) return;
            unawaited(actions.setLanguage(code == 'tr' ? null : Locale(code)));
          },
          child: const Column(
            children: [
              RadioListTile<String>(
                key: ValueKey('language-tr'),
                value: 'tr',
                contentPadding: EdgeInsets.zero,
                title: Text('Türkçe'),
              ),
              RadioListTile<String>(
                key: ValueKey('language-en'),
                value: 'en',
                contentPadding: EdgeInsets.zero,
                title: Text('English'),
              ),
            ],
          ),
        ),
        section(l10n.settingsThemeSection),
        RadioGroup<ThemeMode>(
          groupValue: themeMode,
          onChanged: (mode) {
            if (mode != null) unawaited(actions.setThemeMode(mode));
          },
          child: Column(
            children: [
              for (final (mode, label) in [
                (ThemeMode.system, l10n.settingsThemeSystem),
                (ThemeMode.light, l10n.settingsThemeLight),
                (ThemeMode.dark, l10n.settingsThemeDark),
              ])
                RadioListTile<ThemeMode>(
                  key: ValueKey('theme-${mode.name}'),
                  value: mode,
                  contentPadding: EdgeInsets.zero,
                  title: Text(label),
                ),
            ],
          ),
        ),
        section(l10n.settingsNotificationsSection),
        Text(
          switch (push) {
            PushRegistration.unavailable => l10n.settingsPushUnavailable,
            PushRegistration.waitingForAccount => l10n.settingsPushWaiting,
            PushRegistration.registered => l10n.settingsPushRegistered,
            PushRegistration.failed => l10n.settingsPushFailed,
          },
          key: ValueKey('push-${push.name}'),
          style: theme.textTheme.bodyMedium,
        ),
        section(l10n.settingsPrivacySection),
        Text(l10n.settingsPrivacyBody, style: theme.textTheme.bodyMedium),
      ],
    );
  }
}

/// Settings locations.
abstract final class SettingsPaths {
  static const deleteAccount = '${AppPaths.settings}/delete-account';
}
