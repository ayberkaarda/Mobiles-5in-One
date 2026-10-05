import 'package:askida/core/locale/app_locale.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/features/merchant/merchant_paths.dart';
import 'package:askida/features/settings/presentation/settings_controller.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

import 'support/flows.dart';
import 'support/harness.dart';

/// Release screenshots: one sample story on the local stack (a sample shop
/// in Beşiktaş, a donation, a reservation, a hand-typed redemption), plus
/// the history, impact, settings, account deletion, catalog and redemption
/// log screens, two dark-scheme screens and one English screen.
/// At each screen the run prints `E2E-STEP SHOT <slug>` and holds still;
/// capture_screenshots.sh takes the frame with `adb exec-out screencap -p`.
/// Every shop and person name on screen carries the `[ÖRNEK]` label.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  const shopName = '[ÖRNEK] Meydan Fırını';
  const hold = Duration(seconds: 8);

  testWidgets('release screens', (tester) async {
    Future<void> shot(String slug) async {
      FocusManager.instance.primaryFocus?.unfocus();
      await settleSoon(tester, const Duration(seconds: 2));
      mark('SHOT $slug');
      await settleSoon(tester, hold);
    }

    Future<void> open(String location, Finder ready, String slug) async {
      await go(tester, location);
      await reveal(tester, ready);
      await shot(slug);
    }

    final merchantTokens = InMemoryTokenStore();
    final picker = InMemoryPngPicker();
    await launchApp(tester, tokens: merchantTokens, picker: picker);
    await registerAndVerify(
      tester,
      name: '[ÖRNEK] Meydan Fırını Esnafı',
      email: 'ornek-meydan-$runId@example.test',
      password: throwawayPassword(),
      merchant: true,
    );
    await registerShop(
      tester,
      name: shopName,
      address: '[ÖRNEK] Örnek Sokak No: 7, Sinanpaşa',
      ilce: 'Beşiktaş',
      picker: picker,
      shot: shot,
    );
    final itemId = await addItem(
      tester,
      name: 'Ekmek',
      category: ItemCategory.ekmek,
      price: '15',
      dailyCap: '20',
    );
    await shot('15-merchant-catalog');

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
    await go(tester, AppPaths.donorDonations);
    await reveal(tester, find.textContaining('Meydan Fırını'));
    await pumpUntil(tester, byKey('impact-card'), reason: 'impact card');
    await shot('12-donor-history');
    await go(tester, '/donor');
    // The home keeps the scroll offset of the donation; back to the top.
    await tester.fling(byKey('donor-home'), const Offset(0, 3000), 4000);
    await settleSoon(tester, const Duration(seconds: 2));
    await pumpUntil(tester, byKey('impact-card'), reason: 'impact card');
    await shot('13-donor-impact');
    await open(
      AppPaths.settings,
      byKey('settings-delete'),
      '20-donor-settings',
    );
    await open(
      '${AppPaths.settings}/delete-account',
      byKey('delete-submit'),
      '21-donor-delete-account',
    );

    await launchApp(tester, tokens: InMemoryTokenStore());
    final code = await reserveAsRecipient(
      tester,
      district: 'Beşiktaş',
      shopText: 'Meydan Fırını',
      itemId: itemId,
      shot: shot,
    );
    await open(
      AppPaths.settings,
      byKey('language-tr'),
      '09-recipient-settings',
    );

    await launchApp(tester, tokens: merchantTokens);
    await redeemByHand(tester, code: code, shot: shot);
    await open(
      MerchantPaths.redemptions,
      byKey('day-count'),
      '18-merchant-redemptions',
    );

    // Dark scheme, set for this run only (nothing is stored).
    final container = containerOf(tester);
    container.read(themeModeProvider.notifier).set(ThemeMode.dark);
    await open(
      MerchantPaths.home,
      byKey('merchant-redeem'),
      '22-merchant-home-dark',
    );
    await open(
      MerchantPaths.redemptions,
      byKey('day-count'),
      '23-merchant-redemptions-dark',
    );

    // English, light scheme.
    container.read(themeModeProvider.notifier).set(ThemeMode.light);
    container.read(appLocaleProvider.notifier).set(const Locale('en'));
    await open(
      MerchantPaths.catalog,
      byKey('catalog-add'),
      '24-merchant-catalog-en',
    );
  });
}
