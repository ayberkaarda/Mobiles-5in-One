import 'package:askida/core/platform/media_picker.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/merchant/merchant_home_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import '../../fakes/fake_media_picker.dart';
import '../../fakes/fake_qr_scanner.dart';
import '../../helpers/pump_app.dart';
import 'merchant_harness.dart';

/// Tall enough that the forms are built without scrolling.
const Size _tall = Size(420, 2000);

Future<TestApp> _pump(
  WidgetTester tester,
  MerchantHarness h, {
  String location = '/merchant',
  SessionState? session,
  Size size = _tall,
}) => tester.pumpAskida(
  session: session ?? merchantSession,
  overrides: h.appOverrides,
  initialLocation: location,
  size: size,
);

Future<void> _enter(WidgetTester tester, String key, String text) async {
  final field = find.byKey(ValueKey(key));
  await tester.ensureVisible(field);
  await tester.enterText(field, text);
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

class _FailingScanner extends FakeQrScanner {
  @override
  Future<void> start() async => throw StateError('camera permission');
}

void main() {
  group('merchant home', () {
    testWidgets('a guest is asked to sign in with a shop account', (
      tester,
    ) async {
      final h = MerchantHarness();
      await tester.pumpScreen(
        const MerchantHomeScreen(),
        overrides: [
          ...h.appOverrides,
          sessionProvider.overrideWith(
            () => FixedSession(const SessionState(restored: true)),
          ),
        ],
        routes: [
          GoRoute(
            path: '/auth',
            builder: (context, state) =>
                Text('auth from ${state.uri.queryParameters['from']}'),
          ),
        ],
      );
      expect(find.text('Dükkânın henüz listede değil'), findsOneWidget);
      await _tap(tester, find.text('Giriş yap'));
      expect(find.text('auth from /merchant'), findsOneWidget);
      expect(h.shops.calls, isEmpty);
    });

    testWidgets('a donor account is told the section needs a shop account', (
      tester,
    ) async {
      final h = MerchantHarness();
      await _pump(tester, h, session: donorSession);
      expect(find.textContaining('Bağışçı hesabınla'), findsOneWidget);
      expect(find.text('Giriş yap'), findsNothing);
      expect(h.shops.calls, isEmpty);
    });

    testWidgets('a merchant without a shop can register one', (tester) async {
      final h = MerchantHarness(role: null);
      await _pump(tester, h);
      expect(find.text('Dükkânını ekle'), findsOneWidget);
      expect(find.textContaining('dükkâna eklendiğinde'), findsOneWidget);
      await _tap(tester, find.text('Dükkânımı kaydet'));
      expect(find.text('Adım 1 / 3'), findsOneWidget);
    });

    testWidgets('refresh shows a shop the account was added to meanwhile', (
      tester,
    ) async {
      final h = MerchantHarness(role: null);
      await _pump(tester, h);
      expect(find.text('Dükkânını ekle'), findsOneWidget);
      h.shops.staffShops = [myShopFor(ownerShop(), ShopRole.staff)];
      await _tap(
        tester,
        find.byKey(const ValueKey('merchant-no-shop-refresh')),
      );
      expect(find.text('Çalışan'), findsOneWidget);
      expect(find.text('Kod okut'), findsOneWidget);
      expect(h.shops.calls.where((c) => c == 'myShops'), hasLength(2));
    });

    for (final (state, text) in [
      (VerificationState.pending, 'Kaydın inceleniyor'),
      (VerificationState.verified, 'Doğrulanmış'),
      (VerificationState.rejected, 'Kaydın onaylanmadı'),
    ]) {
      testWidgets('owner dashboard shows the ${state.name} state', (
        tester,
      ) async {
        final h = MerchantHarness(state: state);
        await _pump(tester, h);
        expect(find.text(text), findsOneWidget);
        expect(find.text('Dükkân sahibi'), findsOneWidget);
        for (final row in ['Verilenler', 'Ürünler', 'Ödemeler', 'Belgeler']) {
          expect(find.text(row), findsOneWidget);
        }
      });
    }

    testWidgets('staff see only scanning, the list and the catalog', (
      tester,
    ) async {
      final h = MerchantHarness(role: ShopRole.staff);
      final app = await _pump(tester, h);
      expect(find.text('Çalışan'), findsOneWidget);
      expect(find.text('Ödemeler'), findsNothing);
      expect(find.text('Belgeler'), findsNothing);
      expect(find.text('Dükkân bilgileri'), findsNothing);
      expect(find.textContaining('dükkân sahibi yönetir'), findsOneWidget);

      // Owner-only screens send staff home, even by direct location.
      for (final path in [
        '/merchant/payouts',
        '/merchant/documents',
        '/merchant/profile',
        '/merchant/catalog/new',
      ]) {
        app.router.go(path);
        await tester.pumpAndSettle();
        expect(app.location, '/merchant', reason: path);
      }
    });

    testWidgets('screens that need a shop send a shopless merchant home', (
      tester,
    ) async {
      final h = MerchantHarness(role: null);
      final app = await _pump(tester, h);
      app.router.go('/merchant/redeem');
      await tester.pumpAndSettle();
      expect(app.location, '/merchant');
    });

    testWidgets('offline owner shape: the dashboard still opens', (
      tester,
    ) async {
      final h = MerchantHarness()
        ..shops.failAlways(
          'bySlug',
          const ApiProblem(code: ApiProblem.networkOffline, status: 0),
        );
      await _pump(tester, h);
      expect(find.textContaining('Bağlantı yok'), findsOneWidget);
      expect(find.text('Kod okut'), findsOneWidget);
    });
  });

  group('shop registration', () {
    Future<void> fillDetails(WidgetTester tester) async {
      await _enter(tester, 'field-name', '[ÖRNEK] Köşe Fırını');
      await _tap(tester, find.byKey(const ValueKey('shop-type')));
      await tester.tap(find.text('Fırın').last);
      await tester.pumpAndSettle();
      await _enter(tester, 'field-phone', '0212 555 00 00');
      await _enter(tester, 'field-tax', '1234567890');
      await _enter(tester, 'field-iban', sampleIban());
    }

    Future<void> fillLocation(WidgetTester tester) async {
      await _enter(tester, 'field-address', 'Halaskargazi Cd. 1');
      await _enter(tester, 'field-il', 'İstanbul');
      await _enter(tester, 'field-ilce', 'Şişli');
    }

    testWidgets('three steps, then the shop is pending and documents open', (
      tester,
    ) async {
      final h = MerchantHarness(role: null);
      final app = await _pump(tester, h, location: '/merchant/register');
      expect(find.text('Adım 1 / 3'), findsOneWidget);

      // Nothing filled: the step does not advance.
      await _tap(tester, find.byKey(const ValueKey('wizard-next')));
      expect(find.text('Bu alan gerekli.'), findsWidgets);
      expect(find.text('Adım 1 / 3'), findsOneWidget);

      await fillDetails(tester);
      await _tap(tester, find.byKey(const ValueKey('wizard-next')));
      expect(find.text('Adım 2 / 3'), findsOneWidget);

      await fillLocation(tester);
      // No pin yet.
      await _tap(tester, find.byKey(const ValueKey('wizard-next')));
      expect(find.byKey(const ValueKey('pin-error')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('map-pin-picker')));
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('shop-pin')), findsOneWidget);
      expect(find.textContaining('İşaretlenen konum'), findsOneWidget);
      expect(h.tiles.requested, isNotEmpty, reason: 'fake tiles only');

      await _tap(tester, find.byKey(const ValueKey('wizard-next')));
      expect(find.text('Adım 3 / 3'), findsOneWidget);
      expect(find.text('+902125550000'), findsOneWidget);

      await _tap(tester, find.byKey(const ValueKey('wizard-submit')));
      expect(h.shops.calls, contains('create'));
      expect(h.shops.ownShop!.name, '[ÖRNEK] Köşe Fırını');
      expect(h.shops.ownShop!.type, ShopType.bakery);
      expect(h.shops.ownShop!.verificationState, VerificationState.pending);
      expect(app.location, '/merchant/documents');
    });

    testWidgets('server field errors take the owner back to the field', (
      tester,
    ) async {
      final h = MerchantHarness(role: null)
        ..shops.failNext(
          'create',
          const ApiProblem(
            code: 'validation.failed',
            status: 422,
            fieldErrors: [FieldError(field: 'tax_number', code: 'tax_number')],
          ),
        );
      await _pump(tester, h, location: '/merchant/register');
      await fillDetails(tester);
      await _tap(tester, find.byKey(const ValueKey('wizard-next')));
      await fillLocation(tester);
      await tester.tap(find.byKey(const ValueKey('map-pin-picker')));
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pumpAndSettle();
      await _tap(tester, find.byKey(const ValueKey('wizard-next')));
      await _tap(tester, find.byKey(const ValueKey('wizard-submit')));

      expect(find.text('Adım 1 / 3'), findsOneWidget);
      expect(find.byKey(const ValueKey('wizard-error')), findsOneWidget);
      expect(find.text('Bu değer geçerli görünmüyor.'), findsOneWidget);
    });

    testWidgets('"Konumumu kullan" explains first, then pins the device spot', (
      tester,
    ) async {
      final h = MerchantHarness(role: null);
      await _pump(tester, h, location: '/merchant/register');
      await fillDetails(tester);
      await _tap(tester, find.byKey(const ValueKey('wizard-next')));

      await _tap(tester, find.text('Konumumu kullan'));
      expect(find.text('Konumun neden gerekli?'), findsOneWidget);
      await _tap(tester, find.text('Devam').last);

      expect(h.location.requests, 1);
      expect(h.location.preciseCalls, [true]);
      expect(
        find.text('İşaretlenen konum: 41.06322, 28.99284'),
        findsOneWidget,
      );
    });

    testWidgets('a refused permission leaves tapping the map', (tester) async {
      final h = MerchantHarness(role: null)
        ..location.afterRequest = LocationPermissionState.deniedForever;
      await _pump(tester, h, location: '/merchant/register');
      await fillDetails(tester);
      await _tap(tester, find.byKey(const ValueKey('wizard-next')));
      await _tap(tester, find.text('Konumumu kullan'));
      await _tap(tester, find.text('Devam').last);
      expect(find.textContaining('Konum alınamadı'), findsOneWidget);
      expect(h.location.preciseCalls, isEmpty);
    });
  });

  group('documents', () {
    testWidgets('a photo is sent and listed', (tester) async {
      final h = MerchantHarness()..picker.next = FakeMediaPicker.sampleJpeg();
      await _pump(tester, h, location: '/merchant/documents');
      await _tap(tester, find.text('İşletme belgesi'));
      await _tap(tester, find.byKey(const ValueKey('document-gallery')));
      expect(find.text('Gönderilen belgeler'), findsOneWidget);
      expect(find.text('Alındı, incelenecek'), findsOneWidget);
      expect(h.shops.calls, contains('confirmDocument'));
    });

    testWidgets('a non-image file is refused with a clear message', (
      tester,
    ) async {
      final h = MerchantHarness()
        ..picker.failure = const UnsupportedDocument('type');
      await _pump(tester, h, location: '/merchant/documents');
      await _tap(tester, find.byKey(const ValueKey('document-camera')));
      expect(find.byKey(const ValueKey('document-error')), findsOneWidget);
      expect(find.textContaining('Yalnızca JPEG ya da PNG'), findsOneWidget);
      expect(h.shops.calls, isNot(contains('presignDocument')));
    });
  });

  group('catalog', () {
    testWidgets('owner adds an item and switches one off', (tester) async {
      final h = MerchantHarness();
      final app = await _pump(tester, h, location: '/merchant/catalog');
      expect(find.text('Ekmek'), findsWidgets);
      expect(find.textContaining('₺15,00'), findsOneWidget);
      expect(find.textContaining('Pasif'), findsOneWidget);

      await _tap(tester, find.byKey(const ValueKey('catalog-add')));
      expect(find.text('Yeni ürün'), findsOneWidget);
      await _tap(tester, find.byKey(const ValueKey('item-save')));
      expect(find.text('Bu alan gerekli.'), findsWidgets);

      await _enter(tester, 'item-name', 'Mercimek çorbası');
      await _tap(tester, find.byKey(const ValueKey('item-category')));
      await tester.tap(find.text('Çorba').last);
      await tester.pumpAndSettle();
      await _enter(tester, 'item-price', '45,5');
      await _enter(tester, 'item-cap', '20');
      await _tap(tester, find.byKey(const ValueKey('item-save')));

      expect(app.location, '/merchant/catalog');
      expect(find.text('Mercimek çorbası'), findsOneWidget);
      expect(find.textContaining('₺45,50'), findsOneWidget);
      final created = h.shops.catalog[ownerShop().id]!.last;
      expect(created.priceMinor, 4550);
      expect(created.dailyCap, 20);

      await _tap(tester, find.bySemanticsLabel('Ekmek askıda olsun'));
      expect(h.shops.calls, contains('updateItem'));
      expect(h.shops.catalog[ownerShop().id]!.first.active, isFalse);
    });

    testWidgets('owner edits a price; only the change is sent', (tester) async {
      final h = MerchantHarness();
      final app = await _pump(tester, h, location: '/merchant/catalog');
      final first = h.shops.catalog[ownerShop().id]!.first;
      await _tap(tester, find.byKey(ValueKey('item-${first.id}')));
      expect(find.text('Ürünü düzenle'), findsOneWidget);
      expect(find.text('15,00'), findsOneWidget);
      await _enter(tester, 'item-price', '17,25');
      await _tap(tester, find.byKey(const ValueKey('item-save')));
      expect(app.location, '/merchant/catalog');
      expect(find.textContaining('₺17,25'), findsOneWidget);
    });

    testWidgets('staff see the list without editing', (tester) async {
      final h = MerchantHarness(role: ShopRole.staff);
      await _pump(tester, h, location: '/merchant/catalog');
      expect(find.text('Ekmek'), findsWidgets);
      expect(find.byKey(const ValueKey('catalog-add')), findsNothing);
      expect(find.byType(Switch), findsNothing);
    });
  });

  group('redeem', () {
    testWidgets('a scanned code shows only what to hand over', (tester) async {
      final h = MerchantHarness(state: VerificationState.verified);
      await _pump(tester, h, location: '/merchant/redeem');
      expect(h.scanner.running, isTrue);
      expect(find.byKey(const ValueKey('fake-qr-preview')), findsOneWidget);

      final code = h.hooks.reservation.code;
      h.scanner.scan(code);
      await tester.pumpAndSettle();

      expect(find.text('Kod onaylandı'), findsOneWidget);
      expect(find.text('1 Ekmek verildi'), findsOneWidget);
      // Nothing that could identify the person or the code stays visible.
      expect(find.textContaining(code), findsNothing);
      expect(h.scanner.running, isFalse);

      // The same QR seen again does not redeem twice.
      h.scanner.scan('$code ');
      await tester.pumpAndSettle();
      expect(h.hooks.callCount('redeem'), 1);

      await _tap(tester, find.byKey(const ValueKey('redeem-next')));
      expect(h.scanner.running, isTrue);
      expect(find.byKey(const ValueKey('manual-code')), findsOneWidget);
    });

    testWidgets('typed codes: malformed, refused, then accepted', (
      tester,
    ) async {
      final h = MerchantHarness();
      await _pump(tester, h, location: '/merchant/redeem');

      await _enter(tester, 'manual-code', 'abc');
      await _tap(tester, find.byKey(const ValueKey('manual-submit')));
      expect(find.textContaining('Bu bir Askıda kodu değil'), findsOneWidget);
      expect(h.hooks.calls, isEmpty);

      await _tap(tester, find.byKey(const ValueKey('redeem-retry')));
      await _enter(tester, 'manual-code', 'zzzz zzzz');
      // The formatter writes capitals without locale casing.
      expect(find.text('ZZZZ ZZZZ'), findsOneWidget);
      await _tap(tester, find.byKey(const ValueKey('manual-submit')));
      expect(find.textContaining('Bu kod geçerli değil'), findsOneWidget);

      await _tap(tester, find.byKey(const ValueKey('redeem-retry')));
      await _enter(tester, 'manual-code', h.hooks.reservation.code);
      await _tap(tester, find.byKey(const ValueKey('manual-submit')));
      expect(find.text('1 Ekmek verildi'), findsOneWidget);
    });

    testWidgets('no camera: typing the code still works', (tester) async {
      final h = MerchantHarness()..makeScanner = _FailingScanner.new;
      await _pump(tester, h, location: '/merchant/redeem');
      expect(find.byKey(const ValueKey('camera-failed')), findsOneWidget);
      expect(find.byKey(const ValueKey('manual-code')), findsOneWidget);
    });

    testWidgets('leaving the screen releases the camera', (tester) async {
      final h = MerchantHarness();
      final app = await _pump(tester, h, location: '/merchant/redeem');
      final scanner = h.scanner;
      app.router.go('/merchant');
      await tester.pumpAndSettle();
      expect(scanner.disposed, isTrue);
    });
  });

  group('redemptions', () {
    testWidgets('today from the server, other days from the device log', (
      tester,
    ) async {
      final h = MerchantHarness();
      final app = await _pump(tester, h, location: '/merchant/redemptions');
      expect(find.byKey(const ValueKey('day-count')), findsOneWidget);
      expect(
        tester.widget<Text>(find.byKey(const ValueKey('day-count'))).data,
        '2',
      );
      expect(find.text('1 Ekmek verildi'), findsOneWidget);
      expect(find.text('1 Mercimek çorbası verildi'), findsOneWidget);
      expect(find.text('Çalışan'), findsOneWidget);
      final logged = await app.database.redemptionsBetween(
        ownerShop().id,
        DateTime(2026, 10, 4),
        DateTime(2026, 10, 5),
      );
      expect(logged, hasLength(2));

      await _tap(tester, find.text('Dün'));
      expect(find.text('Bu gün askıdan bir şey verilmedi.'), findsOneWidget);
    });

    testWidgets('offline shows the saved list with a note', (tester) async {
      final h = MerchantHarness()
        ..hooks.failAlways(
          'redemptions',
          const ApiProblem(code: ApiProblem.networkOffline, status: 0),
        );
      await _pump(tester, h, location: '/merchant/redemptions');
      expect(find.byKey(const ValueKey('log-offline')), findsOneWidget);
    });
  });

  testWidgets('payouts list net, commission and status per day', (
    tester,
  ) async {
    final h = MerchantHarness();
    await _pump(tester, h, location: '/merchant/payouts');
    expect(find.text('₺427,50'), findsOneWidget);
    expect(find.text('Bağış ₺450,00 · Komisyon ₺22,50'), findsOneWidget);
    expect(find.text('27 ürün verildi'), findsOneWidget);
    expect(find.text('Aktarıldı'), findsOneWidget);
    expect(find.text('Bekliyor'), findsOneWidget);
  });

  testWidgets('payouts failure offers a retry', (tester) async {
    final h = MerchantHarness()
      ..payouts.failNext(
        'payouts',
        const ApiProblem(code: 'server_error', status: 500),
      );
    await _pump(tester, h, location: '/merchant/payouts');
    expect(find.text('Yeniden dene'), findsOneWidget);
    await _tap(tester, find.text('Yeniden dene'));
    expect(find.text('Aktarıldı'), findsOneWidget);
  });

  testWidgets('profile saves only what changed', (tester) async {
    final h = MerchantHarness(state: VerificationState.rejected);
    await _pump(tester, h, location: '/merchant/profile');
    expect(find.text('Kaydın onaylanmadı'), findsOneWidget);
    expect(find.textContaining('******1234'), findsOneWidget);
    await _enter(tester, 'profile-name', 'Köşe Fırını Şişli');
    await _tap(tester, find.byKey(const ValueKey('profile-save')));
    expect(find.byKey(const ValueKey('profile-saved')), findsOneWidget);
    expect(h.shops.ownShop!.name, 'Köşe Fırını Şişli');
  });

  group('layout at text scale 1.3 and 320 px', () {
    final screens = {
      'dashboard': '/merchant',
      'register': '/merchant/register',
      'documents': '/merchant/documents',
      'catalog': '/merchant/catalog',
      'item form': '/merchant/catalog/new',
      'redeem': '/merchant/redeem',
      'redemptions': '/merchant/redemptions',
      'payouts': '/merchant/payouts',
      'profile': '/merchant/profile',
    };
    for (final MapEntry(key: name, value: path) in screens.entries) {
      for (final (scale, size) in layoutCases) {
        testWidgets('$name at $scale ${size ?? 'phone'}', (tester) async {
          final h = MerchantHarness(state: VerificationState.rejected);
          await tester.pumpAskida(
            session: merchantSession,
            overrides: h.appOverrides,
            initialLocation: path,
            textScale: scale,
            size: size ?? const Size(360, 780),
          );
          expect(tester.takeException(), isNull);
        });
      }
    }

    testWidgets('redeem success at 1.3 and 320 px', (tester) async {
      final h = MerchantHarness();
      await tester.pumpAskida(
        session: merchantSession,
        overrides: h.appOverrides,
        initialLocation: '/merchant/redeem',
        textScale: 1.3,
        size: const Size(320, 640),
      );
      h.scanner.scan(h.hooks.reservation.code);
      await tester.pumpAndSettle();
      expect(find.text('1 Ekmek verildi'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
