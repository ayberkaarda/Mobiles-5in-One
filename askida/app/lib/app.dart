import 'package:askida/core/locale/app_locale.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/routing/app_router.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AskidaApp extends ConsumerWidget {
  const new({super.key, this.locale});

  /// Forces a locale (tests, settings). When null the app runs in tr_TR so
  /// the font picks the Turkish dotted and dotless i forms.
  final Locale? locale;

  static const Locale defaultLocale = Locale('tr', 'TR');

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(appRouterProvider);
    return MaterialApp.router(
      onGenerateTitle: (context) => AppLocalizations.of(context).appTitle,
      debugShowCheckedModeBanner: false,
      theme: AskidaTheme.light(),
      darkTheme: AskidaTheme.dark(),
      locale: locale ?? ref.watch(appLocaleProvider) ?? defaultLocale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      routerConfig: router,
    );
  }
}
