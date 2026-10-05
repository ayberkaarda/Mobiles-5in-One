import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/item.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support/flows.dart';
import 'support/harness.dart';

/// Release screenshots: one sample story on the local stack (a sample shop
/// in Beşiktaş, a donation, a reservation, a hand-typed redemption). At
/// each of the six screens the run prints `E2E-STEP SHOT <slug>` and holds
/// still; capture_screenshots.sh takes the frame with `adb exec-out
/// screencap -p`. Every name on screen carries the `[ÖRNEK]` label.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const shopName = '[ÖRNEK] Mahalle Fırını';
  const hold = Duration(seconds: 8);

  testWidgets('six release screens', (tester) async {
    Future<void> shot(String slug) async {
      FocusManager.instance.primaryFocus?.unfocus();
      await settleSoon(tester, const Duration(seconds: 2));
      mark('SHOT $slug');
      await settleSoon(tester, hold);
    }

    final merchantTokens = InMemoryTokenStore();
    final picker = InMemoryPngPicker();
    await launchApp(tester, tokens: merchantTokens, picker: picker);
    await registerAndVerify(
      tester,
      name: '[ÖRNEK] Mahalle Esnafı',
      email: 'ornek-mahalle-$runId@example.test',
      password: throwawayPassword(),
      merchant: true,
    );
    await registerShop(
      tester,
      name: shopName,
      address: '[ÖRNEK] Örnek Sokak No: 7, Sinanpaşa',
      ilce: 'Beşiktaş',
      picker: picker,
    );
    final itemId = await addItem(
      tester,
      name: 'Ekmek',
      category: ItemCategory.ekmek,
      price: '15',
      dailyCap: '20',
    );

    await launchApp(tester, tokens: InMemoryTokenStore());
    await registerAndVerify(
      tester,
      name: '[ÖRNEK] Bağışçı',
      email: 'ornek-bagisci-$runId@example.test',
      password: throwawayPassword(),
      merchant: false,
    );
    await donate(
      tester,
      ilce: 'Beşiktaş',
      shopName: shopName,
      itemId: itemId,
      qty: 3,
      shot: shot,
    );

    await launchApp(tester, tokens: InMemoryTokenStore());
    final code = await reserveAsRecipient(
      tester,
      district: 'Beşiktaş',
      shopText: 'Mahalle Fırını',
      itemId: itemId,
      shot: shot,
    );

    await launchApp(tester, tokens: merchantTokens);
    await redeemByHand(tester, code: code, shot: shot);
  });
}
