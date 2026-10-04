import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/design/widgets/code_tag.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:askida/features/merchant/presentation/screens/catalog_screen.dart';
import 'package:askida/features/merchant/presentation/widgets/shop_form_fields.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_flutter/webview_flutter.dart';

import 'harness.dart';

/// Steps the device flows share. Each drives the real screens; the
/// optional [Shot] callbacks let the screenshot run pause on a screen.
typedef Shot = Future<void> Function(String slug);

/// Registers an account on the app's form and enters the code from the
/// verification mail.
Future<void> registerAndVerify(
  WidgetTester tester, {
  required String name,
  required String email,
  required String password,
  required bool merchant,
}) async {
  await go(tester, '/auth/register');
  await enterInto(tester, byKey('register-name'), name);
  await enterInto(tester, byKey('register-email'), email);
  await enterInto(tester, byKey('register-password'), password);
  await tapOn(
    tester,
    byKey(merchant ? 'register-kind-merchant' : 'register-kind-donor'),
  );
  await tapOn(tester, byKey('register-consent'));
  await tapOn(tester, byKey('register-submit'));
  await pumpUntil(tester, byKey('code-field'), reason: 'verify screen');
  mark('registered $email');

  final verification = await verificationCodeFor(email);
  await enterInto(tester, byKey('code-field'), verification);
  await tapOn(tester, byKey('verify-submit'));
  await pumpUntil(
    tester,
    find.text(tr.authVerifyDone),
    reason: 'verification confirmation',
  );
  mark('verified $email');
}

/// Runs the shop wizard from the merchant's no-shop home, uploads one
/// document through [picker] and waits until the host helper approved the
/// shop. Returns the shop slug.
Future<String> registerShop(
  WidgetTester tester, {
  required String name,
  required String address,
  required String ilce,
  required InMemoryPngPicker picker,
}) async {
  await pumpUntil(tester, find.text(tr.merchantNoShopTitle));

  // Step 1: details.
  await tapOn(tester, find.text(tr.merchantRegisterShop));
  await enterInto(tester, byKey('field-name'), name);
  await tapOn(tester, byKey('shop-type'));
  await tapOn(tester, find.text(shopTypeLabel(tr, ShopType.bakery)).last);
  await enterInto(tester, byKey('field-phone'), '0216 555 01 23');
  await enterInto(tester, byKey('field-tax'), randomTaxNumber());
  await enterInto(tester, byKey('field-iban'), randomIban());
  await tapOn(tester, byKey('wizard-next'));

  // Step 2: address, then the map pin. Going back and forward re-centres
  // the map on the typed district before the pin is dropped.
  await enterInto(tester, byKey('field-address'), address);
  await enterInto(tester, byKey('field-il'), 'İstanbul');
  await enterInto(tester, byKey('field-ilce'), ilce);
  // System back steps the wizard back (PopScope), keeping the fields.
  await tester.binding.handlePopRoute();
  await settleSoon(tester);
  await tapOn(tester, byKey('wizard-next'));
  final map = byKey('map-pin-picker');
  await reveal(tester, map);
  await tester.ensureVisible(map);
  await settleSoon(tester);
  await tester.tapAt(tester.getCenter(map));
  await pumpUntil(tester, byKey('shop-pin'), reason: 'map pin');
  await tapOn(tester, byKey('wizard-next'));

  // Step 3: review and send.
  await tapOn(tester, byKey('wizard-submit'));
  await pumpUntil(
    tester,
    byKey('document-gallery'),
    timeout: const Duration(seconds: 45),
    reason: 'documents screen after POST shops',
  );
  mark('shop created');

  // Document: presign, PUT to the object store at 10.0.2.2, confirm.
  final before = picker.picks;
  await tapOn(tester, byKey('document-gallery'));
  await pumpUntil(
    tester,
    find.text(tr.merchantDocumentReceived),
    timeout: const Duration(seconds: 60),
    reason: 'uploaded document row',
  );
  expect(byKey('document-error'), findsNothing);
  expect(picker.picks, before + 1);
  mark('document uploaded');

  await tapOn(tester, find.text(tr.merchantDocumentsDone));
  await pumpUntil(tester, byKey('verification-pending'));
  final container = containerOf(tester);
  final slug = container.read(merchantShopProvider).value!.slug;
  mark('shop pending $slug');

  // The host helper approves it through shops:verify.
  final end = DateTime.now().add(const Duration(seconds: 120));
  while (byKey('verification-verified').evaluate().isEmpty) {
    if (DateTime.now().isAfter(end)) fail('shop was not verified');
    await container.read(merchantShopProvider.notifier).reload();
    await settleSoon(tester, const Duration(seconds: 2));
  }
  mark('shop verified');
  return slug;
}

/// Adds one catalog item from the merchant home; returns its id.
Future<String> addItem(
  WidgetTester tester, {
  required String name,
  required ItemCategory category,
  required String price,
  required String dailyCap,
}) async {
  await tapOn(tester, find.text(tr.merchantCatalogTitle));
  await tapOn(tester, byKey('catalog-add'));
  await enterInto(tester, byKey('item-name'), name);
  await tapOn(tester, byKey('item-category'));
  await tapOn(tester, find.text(categoryLabel(tr, category)).last);
  await enterInto(tester, byKey('item-price'), price);
  await enterInto(tester, byKey('item-cap'), dailyCap);
  await tapOn(tester, byKey('item-save'));
  // Catalog rows are keyed `item-<uuid>`; the form's fields are not.
  final rowKey = RegExp(r'^item-[0-9a-f]{8}-[0-9a-f-]{27}$');
  final row = find.byWidgetPredicate(
    (w) =>
        w.key is ValueKey<String> &&
        rowKey.hasMatch((w.key! as ValueKey<String>).value),
  );
  await pumpUntil(tester, row, reason: 'catalog row');
  final id = (tester.widget(row.first).key! as ValueKey<String>).value
      .substring('item-'.length);
  mark('item created $id');
  return id;
}

/// From the donor home: picks [ilce], opens [shopName], donates [qty] of
/// [itemId] and pays on the fake checkout page inside the real WebView.
/// Returns the donation id once the paid receipt shows.
Future<String> donate(
  WidgetTester tester, {
  required String ilce,
  required String shopName,
  required String itemId,
  required int qty,
  Shot? shot,
}) async {
  await go(tester, '/donor');
  await tapOn(tester, byKey('donor-pick-district'));
  await tapOn(tester, byKey('district-$ilce'));
  await tapOn(tester, find.text(shopName));
  await tapOn(tester, byKey('item-$itemId'));
  for (var i = 1; i < qty; i++) {
    await tapOn(tester, byKey('qty-plus'));
  }
  expect(tester.widget<Text>(byKey('qty-value')).data, '$qty');
  await shot?.call('04-donor-donate');
  await tapOn(tester, byKey('donate-pay'));

  // The real WebView loads the pay page from the stack; the page's own
  // form button is pressed inside the page.
  await pumpUntil(tester, find.byType(WebViewWidget), reason: 'checkout');
  final webView = tester.widget<WebViewWidget>(find.byType(WebViewWidget));
  final controller = webView.platform.params.controller;
  final end = DateTime.now().add(const Duration(seconds: 45));
  while (true) {
    final ready = await controller.runJavaScriptReturningResult(
      'document.querySelector("form.fake-checkout button") !== null',
    );
    if (ready.toString() == 'true') break;
    if (DateTime.now().isAfter(end)) fail('checkout page did not load');
    await settleSoon(tester, const Duration(seconds: 1));
  }
  mark('checkout page loaded');
  await controller.runJavaScript(
    'document.querySelector("form.fake-checkout button").click()',
  );

  // The result page sends the app back with a script redirect to
  // askida://donation/<id>?status=; if the WebView were still on the result
  // page, the run notes it and presses the page's own "Uygulamaya dön" link.
  final redirectEnd = DateTime.now().add(const Duration(seconds: 15));
  while (find.byType(WebViewWidget).evaluate().isNotEmpty &&
      DateTime.now().isBefore(redirectEnd)) {
    await settleSoon(tester, const Duration(seconds: 1));
  }
  if (find.byType(WebViewWidget).evaluate().isNotEmpty) {
    mark('still in WebView at ${await controller.currentUrl()}');
    await controller.runJavaScript(
      'document.getElementById("back-to-app").click()',
    );
  } else {
    mark('script redirect returned to the app');
  }
  await pumpUntil(
    tester,
    byKey('receipt-paid'),
    timeout: const Duration(seconds: 45),
    reason: 'paid receipt',
  );
  final location = routerOf(tester).state.uri;
  final donationId = location.pathSegments.last;
  mark('donation paid $donationId (${location.query})');
  await shot?.call('05-donor-receipt');
  return donationId;
}

/// A fresh recipient device: anonymous identity first (the shop directory
/// answers anonymous devices only with one; dev flavor fallback when Play
/// Integrity cannot answer), then [district] from the picker, the shop whose
/// name contains [shopText], and a reservation of [itemId]. Returns the code.
Future<String> reserveAsRecipient(
  WidgetTester tester, {
  required String district,
  required String shopText,
  required String itemId,
  Shot? shot,
}) async {
  await go(tester, '/recipient/start?from=%2Frecipient');
  await tapOn(tester, byKey('recipient-attest'));
  await pumpUntil(
    tester,
    find.byWidgetPredicate(
      (w) =>
          w.key == const ValueKey('recipient-intro-start') ||
          w.key == const ValueKey('recipient-pick-district'),
    ),
    reason: 'recipient home after attestation',
  );
  mark('anon identity created');
  if (byKey('recipient-intro-start').evaluate().isNotEmpty) {
    await tapOn(tester, byKey('recipient-intro-start'));
  }
  await tapOn(tester, byKey('recipient-pick-district'));
  final districtRow = byKey('district-İstanbul-$district');
  await tester.scrollUntilVisible(
    districtRow,
    200,
    scrollable: find.byType(Scrollable).last,
  );
  await tapOn(tester, districtRow);

  // The list shows the sample label as a chip next to the name; earlier runs
  // may have left shops at the same spot, so the list scrolls to this one.
  final listed = find.textContaining(shopText);
  await reveal(tester, listed);
  await shot?.call('01-recipient-nearby');
  await tapOn(tester, listed);
  await reveal(tester, byKey('recipient-take-$itemId'));
  await shot?.call('02-recipient-shop');
  await tapOn(tester, byKey('recipient-take-$itemId'));
  await tapOn(tester, byKey('recipient-reserve-confirm'));
  await pumpUntil(tester, find.byType(CodeTag), reason: 'code screen');
  final code = tester.widget<CodeTag>(find.byType(CodeTag)).code;
  expect(code, matches(RegExp(r'^[A-Z0-9 ]{6,12}$')));
  mark('reserved, code length ${code.replaceAll(' ', '').length}');
  await shot?.call('03-recipient-code');
  return code;
}

/// From the merchant home: types [code] on the redemption screen.
Future<void> redeemByHand(
  WidgetTester tester, {
  required String code,
  Shot? shot,
}) async {
  await go(tester, '/merchant');
  await tapOn(tester, byKey('merchant-redeem'));
  await enterInto(tester, byKey('manual-code'), code);
  await tapOn(tester, byKey('manual-submit'));
  await pumpUntil(tester, byKey('redeem-success'), reason: 'redeem result');
  expect(byKey('redeem-failure'), findsNothing);
  mark('redeemed');
  await shot?.call('06-merchant-redeemed');
}
