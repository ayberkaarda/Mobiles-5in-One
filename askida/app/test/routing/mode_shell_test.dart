import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:askida/features/settings/presentation/settings_screen.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/pump_app.dart';

void main() {
  Finder modeTab(AppMode mode) => find.byKey(ValueKey('mode-${mode.name}'));

  AppMode selectedMode(WidgetTester tester) => tester
      .widget<SegmentedButton<AppMode>>(find.byType(SegmentedButton<AppMode>))
      .selected
      .single;

  testWidgets('opens in recipient mode on the first onboarding screen', (
    tester,
  ) async {
    await tester.pumpAskida(locale: const Locale('tr'));

    expect(find.byType(ModeSwitcher), findsOneWidget);
    expect(selectedMode(tester), AppMode.recipient);
    expect(find.byKey(const ValueKey('recipient-intro')), findsOneWidget);
    expect(find.text('Askıda bekleyeni al, soru sorulmaz.'), findsOneWidget);
  });

  testWidgets('switches between the three modes', (tester) async {
    await tester.pumpAskida(locale: const Locale('tr'));

    await tester.tap(modeTab(AppMode.donor));
    await tester.pumpAndSettle();
    expect(find.text('Askıda bıraktığın bir şey yok'), findsOneWidget);
    expect(selectedMode(tester), AppMode.donor);

    await tester.tap(modeTab(AppMode.merchant));
    await tester.pumpAndSettle();
    expect(find.text('Dükkânın henüz listede değil'), findsOneWidget);
    expect(selectedMode(tester), AppMode.merchant);

    await tester.tap(modeTab(AppMode.recipient));
    await tester.pumpAndSettle();
    expect(find.text('Askıda bekleyeni al, soru sorulmaz.'), findsOneWidget);
    expect(selectedMode(tester), AppMode.recipient);
  });

  testWidgets('app bar shows the app name in every mode', (tester) async {
    await tester.pumpAskida(locale: const Locale('tr'));

    await tester.tap(modeTab(AppMode.donor));
    await tester.pumpAndSettle();
    expect(
      find.descendant(of: find.byType(AppBar), matching: find.text('Askıda')),
      findsOneWidget,
    );
  });

  for (final mode in AppMode.values) {
    testWidgets('settings open from the ${mode.name} app bar, no account', (
      tester,
    ) async {
      await tester.pumpAskida(locale: const Locale('tr'));
      await tester.tap(modeTab(mode));
      await tester.pumpAndSettle();

      final action = find.byKey(const ValueKey('shell-settings'));
      expect(action, findsOneWidget);
      expect(find.byTooltip('Ayarlar'), findsOneWidget);
      await tester.tap(action);
      await tester.pumpAndSettle();
      // A pushed page over the shell (the shell's location stays).
      expect(find.byType(SettingsScreen), findsOneWidget);
      expect(find.text('Dil'), findsWidgets);
      expect(find.text('Görünüm'), findsWidgets);

      // Back returns to the same mode.
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();
      expect(find.byType(SettingsScreen), findsNothing);
      expect(selectedMode(tester), mode);
    });
  }
}
