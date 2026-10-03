import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:askida/design/widgets/rail_counter.dart';
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

  testWidgets('opens in recipient mode with the rail counter', (tester) async {
    await tester.pumpAskida(locale: const Locale('tr'));

    expect(find.byType(ModeSwitcher), findsOneWidget);
    expect(selectedMode(tester), AppMode.recipient);
    expect(find.byType(RailCounter), findsOneWidget);
    expect(find.text('ÖRNEK'), findsOneWidget);
    expect(
      find.text('Yakında askıda bekleyen bir şey görünmüyor'),
      findsOneWidget,
    );
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
    expect(
      find.text('Yakında askıda bekleyen bir şey görünmüyor'),
      findsOneWidget,
    );
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
}
