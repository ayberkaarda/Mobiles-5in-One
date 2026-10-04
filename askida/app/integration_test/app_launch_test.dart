import 'package:askida/app.dart';
import 'package:askida/core/env/app_env.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/widgets/mode_switcher.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

/// Device smoke test: the app starts on a real device or emulator with the
/// real plugins (database, links, location) and opens in recipient mode.
/// Run with `flutter test integration_test --flavor dev` on a device; the
/// full flows against the local stack are added in Wave C.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('launches in recipient mode', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appEnvProvider.overrideWithValue(
            AppEnv.parse('http://10.0.2.2:58080/api/v1'),
          ),
          tokenStoreProvider.overrideWithValue(InMemoryTokenStore()),
        ],
        child: const AskidaApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(ModeSwitcher), findsOneWidget);
  });
}
