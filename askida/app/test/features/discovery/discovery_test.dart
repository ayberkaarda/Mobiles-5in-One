import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/discovery/domain/distance.dart';
import 'package:askida/features/discovery/domain/districts.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:askida/features/discovery/presentation/map_tiles.dart';
import 'package:askida/features/discovery/presentation/shop_list_tile.dart';
import 'package:askida/features/discovery/presentation/shop_map_view.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_location_service.dart';
import '../../fakes/fake_shops_repository.dart';
import '../../fakes/fake_tile_provider.dart';
import '../../helpers/pump_app.dart';

void main() {
  group('Distance', () {
    test('Turkish', () async {
      final l10n = await AppLocalizations.delegate.load(const Locale('tr'));
      expect(Distance.format(l10n, 450), '450 m');
      expect(Distance.format(l10n, 447), '450 m');
      expect(Distance.format(l10n, 3), '10 m');
      expect(Distance.format(l10n, 994), '990 m');
      expect(Distance.format(l10n, 1240), '1,2 km');
      expect(Distance.format(l10n, 1000), '1,0 km');
      expect(Distance.format(l10n, 12400), '12 km');
    });

    test('English uses the decimal point', () async {
      final l10n = await AppLocalizations.delegate.load(const Locale('en'));
      expect(Distance.format(l10n, 1240), '1.2 km');
    });
  });

  group('coarse location', () {
    test('coarsen rounds to two decimals', () {
      expect(
        coarsen(const GeoPoint(lat: 41.063217, lng: 28.992841)),
        const GeoPoint(lat: 41.06, lng: 28.99),
      );
      expect(
        coarsen(const GeoPoint(lat: 39.9262, lng: 32.8669)),
        const GeoPoint(lat: 39.93, lng: 32.87),
      );
    });

    test('district list covers the three cities with 2-decimal centres', () {
      expect(pickerProvinces(), ['İstanbul', 'Ankara', 'İzmir']);
      for (final district in kPickerDistricts) {
        expect(
          coarsen(district.center),
          district.center,
          reason: district.label,
        );
      }
    });

    ProviderContainer containerWith(FakeLocationService service) {
      final container = ProviderContainer(
        overrides: [locationServiceProvider.overrideWithValue(service)],
      );
      addTearDown(container.dispose);
      return container;
    }

    test('not asked yet: rationale first, nothing read', () async {
      final service = FakeLocationService();
      final container = containerWith(service);

      await container.read(coarseLocationProvider.notifier).check();

      final state = container.read(coarseLocationProvider);
      expect(state.needsRationale, isTrue);
      expect(state.point, isNull);
      expect(service.preciseCalls, isEmpty);
    });

    test('after the rationale the rounded device point is used', () async {
      final service = FakeLocationService();
      final container = containerWith(service);
      final controller = container.read(coarseLocationProvider.notifier);

      await controller.check();
      await controller.requestAndLocate();

      final state = container.read(coarseLocationProvider);
      expect(state.point, const GeoPoint(lat: 41.06, lng: 28.99));
      expect(state.source, LocationSource.device);
      expect(service.preciseCalls, [
        false,
      ], reason: 'recipients never ask precise');
    });

    test('denied for good offers the district picker', () async {
      final service = FakeLocationService(
        afterRequest: LocationPermissionState.deniedForever,
      );
      final container = containerWith(service);
      final controller = container.read(coarseLocationProvider.notifier);

      await controller.requestAndLocate();
      expect(container.read(coarseLocationProvider).offerDistricts, isTrue);

      controller.chooseDistrict(kPickerDistricts.first);
      final state = container.read(coarseLocationProvider);
      expect(state.source, LocationSource.district);
      expect(state.point, kPickerDistricts.first.center);
      expect(state.offerDistricts, isFalse);
    });

    test('no fix with permission falls back to districts', () async {
      final service = FakeLocationService(
        permissionState: LocationPermissionState.granted,
        position: null,
      );
      final container = containerWith(service);
      await container.read(coarseLocationProvider.notifier).check();
      final state = container.read(coarseLocationProvider);
      expect(state.failed, isTrue);
      expect(state.offerDistricts, isTrue);
    });
  });

  group('widgets', () {
    final shops = FakeShopsRepository.sampleShops();

    testWidgets('ShopListTile fills the design card', (tester) async {
      var tapped = 0;
      await tester.pumpScreen(
        ListView(
          children: [
            for (final shop in shops)
              ShopListTile(shop: shop, onTap: () => tapped++),
          ],
        ),
      );

      expect(find.byType(ShopCard), findsNWidgets(2));
      expect(find.text('[ÖRNEK] Köşe Fırını'), findsOneWidget);
      expect(find.text('Şişli · 450 m'), findsOneWidget);
      expect(find.text('Kadıköy · 1,2 km'), findsOneWidget);
      expect(find.text('ÖRNEK'), findsNWidgets(2));
      await tester.tap(find.byKey(ValueKey('shop-${shops.first.id}')));
      expect(tapped, 1);
    });

    testWidgets('ShopListTile does not overflow at 320 px and 1.3 text', (
      tester,
    ) async {
      await tester.pumpScreen(
        ListView(children: [for (final s in shops) ShopListTile(shop: s)]),
        size: const Size(320, 640),
        textScale: 1.3,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('ShopMapView uses the injected tiles and shows attribution', (
      tester,
    ) async {
      final tiles = FakeTileProvider();
      ShopSummary? opened;
      await tester.pumpScreen(
        SizedBox(
          width: 360,
          height: 480,
          child: ShopMapView(
            center: const GeoPoint(lat: 41.06, lng: 28.99),
            shops: shops,
            zoom: 12,
            onShopTap: (shop) => opened = shop,
          ),
        ),
        overrides: [tileProviderProvider.overrideWithValue(tiles)],
      );

      expect(tiles.requested, isNotEmpty);
      expect(
        tiles.urls.every(
          (u) => u.startsWith('https://tile.openstreetmap.org/'),
        ),
        isTrue,
      );
      expect(
        find.textContaining('OpenStreetMap katkıda bulunanlar'),
        findsOneWidget,
      );
      expect(find.byType(ShopMarker), findsWidgets);
      expect(
        find.bySemanticsLabel('[ÖRNEK] Köşe Fırını, askıda 12'),
        findsOneWidget,
      );

      await tester.tap(find.byKey(ValueKey('marker-${shops.first.id}')));
      expect(opened?.id, shops.first.id);
    });

    testWidgets('a shop with nothing on the rail shows the quiet marker', (
      tester,
    ) async {
      await tester.pumpScreen(
        SizedBox(
          width: 360,
          height: 480,
          child: ShopMapView(
            center: const GeoPoint(lat: 40.99, lng: 29.03),
            shops: [shops.last],
          ),
        ),
        overrides: [tileProviderProvider.overrideWithValue(FakeTileProvider())],
      );
      expect(find.text('—'), findsOneWidget);
    });

    test('the tile factory uses the single template', () {
      final layer = buildTileLayer(FakeTileProvider());
      expect(layer.urlTemplate, kTileUrlTemplate);
      expect(categoryForShopType(ShopType.bakery), ShopCategory.ekmek);
    });
  });
}
