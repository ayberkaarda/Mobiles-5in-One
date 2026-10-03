import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/pump_app.dart';

void main() {
  Finder modeTab(AppMode mode) => find.byKey(ValueKey('mode-${mode.name}'));

  testWidgets('opens in recipient mode with its empty state', (tester) async {
    await tester.pumpAskida(locale: const Locale('tr'));

    expect(
      find.text('Yakında askıda bekleyen bir şey görünmüyor'),
      findsOneWidget,
    );
    final bar = tester.widget<NavigationBar>(find.byType(NavigationBar));
    expect(bar.selectedIndex, AppMode.recipient.index);
    expect(bar.destinations, hasLength(3));
  });

  testWidgets('switches between the three modes', (tester) async {
    await tester.pumpAskida(locale: const Locale('tr'));

    await tester.tap(modeTab(AppMode.donor));
    await tester.pumpAndSettle();
    expect(find.text('Askıda bıraktığın bir şey yok'), findsOneWidget);
    expect(
      tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
      AppMode.donor.index,
    );

    await tester.tap(modeTab(AppMode.merchant));
    await tester.pumpAndSettle();
    expect(find.text('Dükkânın henüz listede değil'), findsOneWidget);
    expect(
      tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex,
      AppMode.merchant.index,
    );

    await tester.tap(modeTab(AppMode.recipient));
    await tester.pumpAndSettle();
    expect(
      find.text('Yakında askıda bekleyen bir şey görünmüyor'),
      findsOneWidget,
    );
  });

  testWidgets('app bar title follows the active mode', (tester) async {
    await tester.pumpAskida(locale: const Locale('tr'));

    await tester.tap(modeTab(AppMode.donor));
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: find.byType(AppBar),
        matching: find.text('Askıya bırak'),
      ),
      findsOneWidget,
    );
  });
}
