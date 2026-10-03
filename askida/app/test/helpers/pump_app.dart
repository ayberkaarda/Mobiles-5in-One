import 'package:askida/app.dart';
import 'package:askida/core/env/app_env.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

final testEnv = AppEnv.parse('http://10.0.2.2:58080/api/v1');

extension PumpApp on WidgetTester {
  Future<void> pumpAskida({Locale? locale}) async {
    await pumpWidget(
      ProviderScope(
        overrides: [appEnvProvider.overrideWithValue(testEnv)],
        child: AskidaApp(locale: locale),
      ),
    );
    await pumpAndSettle();
  }
}
