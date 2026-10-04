import 'package:askida/core/time/clock.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/recipient/data/screen_brightness.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

import '../../fakes/fake_anon_repository.dart';
import '../../fakes/fake_hooks_repository.dart';
import '../../fakes/fake_location_service.dart';
import '../../fakes/fake_misc_repositories.dart';
import '../../fakes/fake_shops_repository.dart';
import '../../fakes/fake_tile_provider.dart';
import '../../helpers/pump_app.dart';

/// Slug and ids of the sample shop in the fixtures.
const sampleSlug = 'ornek-kose-firini-sisli';
const sampleShopId = '0192a4c1-7000-7a10-9b3c-000000000001';
const breadItemId = '0192a4c1-8000-7a10-9b3c-000000000011';

/// A reservation issued at [issuedAt] (local time), valid 10 minutes.
Reservation sampleReservation({DateTime? issuedAt}) => Reservation(
  code: 'K7M2QX9R',
  expiresAt: (issuedAt ?? testNow).add(const Duration(minutes: 10)),
  shop: const ReservationShop(id: sampleShopId, name: '[ÖRNEK] Köşe Fırını'),
  item: const ReservationItem(name: 'Ekmek', category: ItemCategory.ekmek),
);

/// Records brightness requests instead of touching the window.
class FakeScreenBrightness implements ScreenBrightness {
  final List<bool> calls = [];

  @override
  Future<void> setFull({required bool enabled}) async => calls.add(enabled);
}

/// Every seam the recipient screens use, as fakes, with a clock tests can
/// move.
class RecipientFakes {
  new({
    LocationPermissionState permission = LocationPermissionState.unknown,
    DateTime? now,
  }) : location = FakeLocationService(permissionState: permission),
       now = now ?? testNow {
    hooks.reservation = sampleReservation(issuedAt: this.now);
  }

  final shops = FakeShopsRepository();
  final hooks = FakeHooksRepository();
  final impact = FakeImpactRepository();
  final tiles = FakeTileProvider();
  final brightness = FakeScreenBrightness();
  final FakeLocationService location;

  /// "Now" for the app clock; [clock] reads it each time, so tests that
  /// install [clockOverride] can move it to cross the expiry.
  DateTime now;

  DateTime clock() => now;

  /// For containers built without `testOverrides` (which pin the clock).
  Override get clockOverride => clockProvider.overrideWithValue(clock);

  /// Created with the container (it needs the token store and the session).
  FakeAnonRepository? anon;

  /// Applied to [anon] as soon as it exists (scripted failures).
  void Function(FakeAnonRepository anon)? configureAnon;

  List<Override> get overrides => [
    remoteShopsRepositoryProvider.overrideWithValue(shops),
    hooksRepositoryProvider.overrideWithValue(hooks),
    impactRepositoryProvider.overrideWithValue(impact),
    tileProviderProvider.overrideWithValue(tiles),
    locationServiceProvider.overrideWithValue(location),
    screenBrightnessProvider.overrideWithValue(brightness),
    anonRepositoryProvider.overrideWith((ref) {
      final fake = FakeAnonRepository(
        tokens: ref.read(tokenStoreProvider),
        session: ref.read(sessionProvider.notifier),
      );
      configureAnon?.call(fake);
      return anon = fake;
    }),
  ];
}

/// Session of a device that already has its anonymous identity.
const anonSession = SessionState(hasAnonToken: true, restored: true);
