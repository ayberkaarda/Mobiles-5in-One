import 'package:askida/core/webview/checkout_webview.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/discovery/presentation/shop_map_view.dart';
import 'package:askida/features/donor/presentation/donor_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../fakes/fake_donations_repository.dart';
import '../../fakes/fake_shops_repository.dart';
import '../../helpers/pump_app.dart';
import 'donor_harness.dart';

const _slug = 'ornek-kose-firini-sisli';
const _bread = '0192a4c1-8000-7a10-9b3c-000000000011';
const _paidId = '0192a4c1-a000-7a10-9b3c-000000000031';

Future<void> _tap(WidgetTester tester, Finder target) async {
  if (target.evaluate().isEmpty) {
    // Lazily built rows below the fold of the donor home.
    await tester.scrollUntilVisible(
      target,
      200,
      scrollable: find
          .descendant(
            of: find.byKey(const ValueKey('donor-home')),
            matching: find.byType(Scrollable),
          )
          .first,
    );
  }
  await tester.ensureVisible(target);
  await tester.pumpAndSettle();
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> _tapKey(WidgetTester tester, String key) =>
    _tap(tester, find.byKey(ValueKey(key)));

/// A donations fake whose checkout URL is outside the allowlist.
class _EvilCheckoutDonations extends FakeDonationsRepository {
  @override
  Future<DonationCheckout> create(String shopId, String itemId, int qty) async {
    final checkout = await super.create(shopId, itemId, qty);
    return checkout.copyWith(checkoutUrl: 'https://evil.example/pay/x');
  }
}

void main() {
  group('donor home', () {
    testWidgets('signed out: what the mode is for, then shops by location', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/donor',
      );
      expect(find.text('Askıda bıraktığın bir şey yok'), findsOneWidget);
      expect(find.byKey(const ValueKey('donor-location-prompt')), findsOne);
      expect(h.location.requests, 0);

      await _tapKey(tester, 'donor-use-location');
      expect(h.location.requests, 1);
      expect(h.location.preciseCalls, [true]);
      expect(find.text('[ÖRNEK] Köşe Fırını'), findsOneWidget);
      expect(find.text('[ÖRNEK] Mahalle Lokantası'), findsOneWidget);
      expect(h.shops.lastNearby?.lat, h.location.position!.lat);

      await _tapKey(tester, 'donor-view-toggle');
      await _tap(tester, find.text('Harita'));
      expect(find.byType(ShopMapView), findsOneWidget);
      expect(h.tiles.requested, isNotEmpty);

      await _tap(tester, find.text('Liste'));
      await _tap(tester, find.text('[ÖRNEK] Köşe Fırını'));
      expect(app.location, '/donor/shop/$_slug');
      expect(find.text('Mercimek çorbası'), findsOneWidget);
      expect(find.text('₺15,00'), findsOneWidget);
    });

    testWidgets('a refused location leaves the district picker', (
      tester,
    ) async {
      final h = DonorHarness(
        afterRequest: LocationPermissionState.deniedForever,
      );
      await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/donor',
      );
      await _tapKey(tester, 'donor-use-location');
      expect(find.byKey(const ValueKey('donor-use-location')), findsNothing);
      expect(find.textContaining('Konum şu an kullanılamıyor'), findsOneWidget);

      await _tapKey(tester, 'donor-pick-district');
      await _tap(tester, find.byKey(const ValueKey('district-Kadıköy')));
      expect(h.shops.lastNearby?.lat, 40.99);
      expect(find.text('Kadıköy, İstanbul'), findsOneWidget);
      expect(find.text('[ÖRNEK] Köşe Fırını'), findsOneWidget);
    });

    testWidgets('a failing directory offers another try', (tester) async {
      final h = DonorHarness();
      h.shops.failAlways(
        'nearby',
        const ApiProblem(code: 'rate_limited', status: 429),
      );
      await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/donor',
      );
      await _tapKey(tester, 'donor-use-location');
      expect(find.textContaining('çok fazla istek'), findsOneWidget);
      h.shops.clearFailures();
      await _tapKey(tester, 'donor-shops-retry');
      expect(find.text('[ÖRNEK] Köşe Fırını'), findsOneWidget);
    });

    testWidgets('signed-in donors see their impact card and links', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/donor',
      );
      expect(find.byKey(const ValueKey('impact-card')), findsOneWidget);
      expect(find.byKey(const ValueKey('impact-mine')), findsOneWidget);
      await _tapKey(tester, 'donor-history-link');
      expect(app.location, '/donor/donations');
    });

    testWidgets('choosing an item while signed out asks for sign-in', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        initialLocation: '/donor/shop/$_slug',
      );
      await _tapKey(tester, 'item-$_bread');
      expect(app.location, startsWith('/auth?from=%2Fdonor%2Fdonate'));
    });
  });

  group('donation', () {
    testWidgets('quantity, total, payment page and the return link', (
      tester,
    ) async {
      final h = DonorHarness()
        ..checkoutNavigations = [
          'https://askida.app/pay/sample',
          'askida://donation/donation-2?status=paid',
        ];
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: DonorPaths.donate(shopSlug: _slug, itemId: _bread),
      );
      expect(find.text('₺15,00'), findsOneWidget);
      await _tapKey(tester, 'qty-plus');
      await _tapKey(tester, 'qty-plus');
      expect(find.text('3'), findsOneWidget);
      expect(find.text('₺45,00'), findsOneWidget);
      await _tapKey(tester, 'qty-minus');
      await _tapKey(tester, 'qty-plus');

      await _tapKey(tester, 'donate-pay');
      expect(h.donations.calls, ['create']);
      expect(h.donations.donations.first.qty, 3);
      expect(
        find.text('checkout https://askida.app/pay/sample-checkout-donation-2'),
        findsOneWidget,
      );

      await _tapKey(tester, 'fake-checkout-run');
      expect(app.location, '/donor/donation/donation-2?status=paid');
      // The server has not recorded the payment yet: the receipt says so.
      expect(find.byKey(const ValueKey('receipt-initiated')), findsOneWidget);
      expect(find.textContaining('Ödeme sayfası işlemin'), findsOneWidget);

      h.donations.markPaid('donation-2');
      await _tapKey(tester, 'receipt-refresh');
      expect(find.byKey(const ValueKey('receipt-paid')), findsOneWidget);
    });

    testWidgets('navigation outside the allowlist is blocked', (tester) async {
      final h = DonorHarness()
        ..checkoutNavigations = [
          'https://evil.example/steal',
          'http://askida.app/pay/x',
          'https://askida.app/hesap-silme',
        ];
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: DonorPaths.donate(shopSlug: _slug, itemId: _bread),
      );
      await _tapKey(tester, 'donate-pay');
      await _tapKey(tester, 'fake-checkout-run');
      expect(find.text('blocked https://evil.example/steal'), findsOneWidget);
      expect(find.text('blocked http://askida.app/pay/x'), findsOneWidget);
      expect(
        find.text('blocked https://askida.app/hesap-silme'),
        findsOneWidget,
      );
      expect(app.location, startsWith('/donor/donate'));
    });

    testWidgets('a checkout URL outside the allowlist is never loaded', (
      tester,
    ) async {
      final h = DonorHarness()
        ..realCheckout = true
        ..donations = _EvilCheckoutDonations();
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: DonorPaths.donate(shopSlug: _slug, itemId: _bread),
      );
      await _tapKey(tester, 'donate-pay');
      // CheckoutWebView refused to load and reported it.
      expect(find.byType(WebViewWidget), findsNothing);
      expect(find.byType(CheckoutWebView), findsNothing);
      expect(find.byKey(const ValueKey('checkout-blocked')), findsOneWidget);
    });

    testWidgets('leaving the payment page opens the donation status', (
      tester,
    ) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: DonorPaths.donate(shopSlug: _slug, itemId: _bread),
      );
      await _tapKey(tester, 'donate-pay');
      await _tapKey(tester, 'checkout-close');
      await _tapKey(tester, 'donate-leave-confirm');
      expect(app.location, '/donor/donation/donation-2');
      expect(find.byKey(const ValueKey('receipt-initiated')), findsOneWidget);
    });

    testWidgets('limits: 20 units, ₺2 000 per payment, server caps', (
      tester,
    ) async {
      final h = DonorHarness();
      final shop = FakeShopsRepository.samplePublicShop();
      h.shops.details[_slug] = PublicShopDetails(
        shop.copyWith(
          items: [
            ...shop.items,
            const PublicItem(
              id: 'item-tepsi',
              name: 'Tepsi baklava',
              category: ItemCategory.yemek,
              categoryLabel: 'Yemek',
              priceMinor: 45000,
              currency: 'TRY',
              availableCount: 0,
            ),
          ],
        ),
      );
      h.donations.failNext(
        'create',
        const ApiProblem(code: 'donation.cap_exceeded', status: 422),
      );
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: DonorPaths.donate(shopSlug: _slug, itemId: _bread),
      );
      for (var i = 0; i < 25; i++) {
        await tester.tap(find.byKey(const ValueKey('qty-plus')));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(find.text('20'), findsOneWidget);
      expect(
        find.text('Bir bağışta en fazla 20 adet bırakılabilir.'),
        findsOneWidget,
      );
      await _tapKey(tester, 'donate-pay');
      expect(
        find.textContaining('Bugünkü askı bırakma sınırına ulaştın.'),
        findsOneWidget,
      );

      app.router.go(DonorPaths.donate(shopSlug: _slug, itemId: 'item-tepsi'));
      await tester.pumpAndSettle();
      for (var i = 0; i < 6; i++) {
        await tester.tap(find.byKey(const ValueKey('qty-plus')));
        await tester.pump();
      }
      await tester.pumpAndSettle();
      expect(find.text('4'), findsOneWidget);
      expect(
        find.text('Tek ödemede en fazla ₺2.000,00 bırakılabilir.'),
        findsOneWidget,
      );
      expect(find.text('₺1.800,00'), findsOneWidget);
    });

    testWidgets('an item that is gone is explained', (tester) async {
      final h = DonorHarness();
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: DonorPaths.donate(shopSlug: _slug, itemId: 'nope'),
      );
      expect(
        find.text('Bu ürün artık dükkânın listesinde değil.'),
        findsOneWidget,
      );
    });
  });

  group('receipt and history', () {
    testWidgets('a paid receipt shows the commission transparently', (
      tester,
    ) async {
      final h = DonorHarness();
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/donor/donation/$_paidId?status=failed',
      );
      // The server's status wins over the link.
      expect(find.byKey(const ValueKey('receipt-paid')), findsOneWidget);
      expect(find.text('3 × Ekmek'), findsOneWidget);
      expect(find.text('₺45,00'), findsOneWidget);
      expect(find.text('₺42,75'), findsOneWidget);
      expect(find.text('₺2,25'), findsOneWidget);
    });

    testWidgets('an unknown donation shows the problem copy', (tester) async {
      final h = DonorHarness();
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/donor/donation/someone-else',
      );
      expect(find.text('Aradığın kayıt bulunamadı.'), findsOneWidget);
    });

    testWidgets('history lists donations and opens a receipt', (tester) async {
      final h = DonorHarness();
      final app = await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/donor/donations',
      );
      expect(find.byKey(const ValueKey('impact-card')), findsOneWidget);
      await _tapKey(tester, 'donation-$_paidId');
      expect(app.location, '/donor/donation/$_paidId');
    });

    testWidgets('an empty history explains itself', (tester) async {
      final h = DonorHarness();
      h.donations.donations.clear();
      await tester.pumpAskida(
        overrides: h.overrides,
        session: DonorHarness.donorSession,
        initialLocation: '/donor/donations',
      );
      expect(
        find.text('Askıya bıraktıkların burada listelenir.'),
        findsOneWidget,
      );
    });
  });

  group('layout', () {
    for (final (scale, size) in layoutCases) {
      testWidgets('donor screens fit at $scale and ${size?.width ?? 800} px', (
        tester,
      ) async {
        final h = DonorHarness();
        final app = await tester.pumpAskida(
          overrides: h.overrides,
          session: DonorHarness.donorSession,
          textScale: scale,
          size: size,
          initialLocation: '/donor',
        );
        await _tapKey(tester, 'donor-use-location');
        expectNoLayoutErrors(tester);
        for (final location in [
          '/donor/shop/$_slug',
          DonorPaths.donate(shopSlug: _slug, itemId: _bread),
          '/donor/donation/$_paidId',
          '/donor/donations',
        ]) {
          app.router.go(location);
          await tester.pumpAndSettle();
          expectNoLayoutErrors(tester);
        }
      });
    }
  });
}
