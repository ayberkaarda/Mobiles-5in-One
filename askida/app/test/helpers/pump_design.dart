import 'package:askida/design/theme.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// Phone-sized surface used by design widget tests and goldens.
const Size phoneSize = Size(360, 780);

extension PumpDesign on WidgetTester {
  /// Pumps [child] on a phone-sized screen with the Askıda theme.
  Future<void> pumpDesign(
    Widget child, {
    Brightness brightness = Brightness.light,
    double textScale = 1,
    bool disableAnimations = false,
    Size size = phoneSize,
    Locale locale = const Locale('tr', 'TR'),
    bool settle = true,
  }) async {
    view
      ..physicalSize = size
      ..devicePixelRatio = 1;
    addTearDown(view.reset);
    await pumpWidget(
      MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: brightness == Brightness.light
            ? AskidaTheme.light()
            : AskidaTheme.dark(),
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Builder(
          builder: (context) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: TextScaler.linear(textScale),
              disableAnimations: disableAnimations,
            ),
            child: Scaffold(
              body: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: RepaintBoundary(key: designKey, child: child),
              ),
            ),
          ),
        ),
      ),
    );
    if (settle) await pumpAndSettle();
  }
}

/// Key of the boundary around the pumped design widget.
const ValueKey<String> designKey = ValueKey('design-under-test');
