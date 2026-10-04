import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/features/donor/presentation/donor_shop_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support/flows.dart';
import 'support/harness.dart';

/// End-to-end flows on a device against the local stack (fake attestation,
/// fake payment gateway, mail catcher). The tests run in order and hand
/// their results on: the merchant's shop and item are what the donor pays
/// for and the recipient takes. A helper on the host approves pending
/// `Deneme` shops with `php artisan shops:verify` (see run_e2e.sh).
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  final merchantTokens = InMemoryTokenStore();
  final donorTokens = InMemoryTokenStore();
  final donorEmail = 'e2e-bagisci-$runId@example.test';
  final donorPassword = throwawayPassword();
  final shopName = '[ÖRNEK] Deneme Fırını $runId';

  String? shopSlug;
  String? itemId;
  String? donationId;

  testWidgets('merchant: register, verify, shop wizard, document, catalog', (
    tester,
  ) async {
    final picker = InMemoryPngPicker();
    await launchApp(tester, tokens: merchantTokens, picker: picker);
    await registerAndVerify(
      tester,
      name: '[ÖRNEK] Deneme Esnaf',
      email: 'e2e-esnaf-$runId@example.test',
      password: throwawayPassword(),
      merchant: true,
    );
    shopSlug = await registerShop(
      tester,
      name: shopName,
      address: '[ÖRNEK] Deneme Sokak No: 1, Caferağa',
      ilce: 'Kadıköy',
      picker: picker,
    );
    itemId = await addItem(
      tester,
      name: 'Ekmek',
      category: ItemCategory.ekmek,
      price: '15',
      dailyCap: '20',
    );
  });

  testWidgets(
    'donor: register, donate through the fake checkout, hooks on the rail',
    (tester) async {
      expect(itemId, isNotNull, reason: 'merchant flow must pass first');
      await launchApp(tester, tokens: donorTokens);
      await registerAndVerify(
        tester,
        name: '[ÖRNEK] Deneme Bağışçı',
        email: donorEmail,
        password: donorPassword,
        merchant: false,
      );
      donationId = await donate(
        tester,
        ilce: 'Kadıköy',
        shopName: shopName,
        itemId: itemId!,
        qty: 2,
      );

      // The shop's rail now carries the two units.
      await go(tester, '/donor/shop/$shopSlug');
      final itemRow = find.byWidgetPredicate(
        (w) => w is DonorItemRow && w.item.id == itemId,
      );
      await pumpUntil(tester, itemRow);
      expect(tester.widget<DonorItemRow>(itemRow).item.availableCount, 2);
      mark('shop shows 2 hooks');
    },
  );

  testWidgets(
    'recipient reserves anonymously, merchant redeems by manual entry',
    (tester) async {
      expect(donationId, isNotNull, reason: 'earlier flows must pass first');
      await launchApp(tester, tokens: InMemoryTokenStore());
      final code = await reserveAsRecipient(
        tester,
        district: 'Kadıköy',
        shopText: 'Deneme Fırını $runId',
        itemId: itemId!,
      );

      // Same device, the merchant's session: type the code.
      await launchApp(tester, tokens: merchantTokens);
      await redeemByHand(tester, code: code);
    },
  );

  testWidgets('donor deletes the account with a password re-check', (
    tester,
  ) async {
    expect(donationId, isNotNull, reason: 'donor flow must pass first');
    await launchApp(tester, tokens: donorTokens);
    final oldToken = await donorTokens.readUser();
    expect(oldToken, isNotNull);
    await go(tester, '/settings');
    await tapOn(tester, byKey('settings-delete'));
    await enterInto(tester, byKey('delete-password'), donorPassword);
    await tapOn(tester, byKey('delete-submit'));
    await tapOn(tester, byKey('delete-confirm'));
    await pumpUntil(tester, byKey('delete-done'), reason: 'deletion done');
    expect(await donorTokens.readUser(), isNull);

    // The account is deactivated at once: the token it held is refused.
    // (Signing in again within the 7-day grace period would cancel the
    // deletion by design, so that is not tried here.)
    expect(await statusWithToken('me', oldToken!), 401);
    mark('account deleted, old token refused');
  });
}
