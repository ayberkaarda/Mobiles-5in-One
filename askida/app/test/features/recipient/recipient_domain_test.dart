import 'package:askida/data/models/shop.dart';
import 'package:askida/features/discovery/domain/districts.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:askida/features/recipient/domain/active_code.dart';
import 'package:askida/features/recipient/domain/code_timing.dart';
import 'package:askida/features/recipient/domain/recipient_paths.dart';
import 'package:askida/features/recipient/domain/return_location.dart';
import 'package:askida/features/recipient/domain/search_area.dart';
import 'package:askida/routing/guards.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_shops_repository.dart';
import 'recipient_helpers.dart';

void main() {
  group('CodeTiming', () {
    final expires = DateTime(2026, 10, 4, 9, 51);

    test('counts down to the expiry and never below zero', () {
      expect(
        CodeTiming.remaining(expires, DateTime(2026, 10, 4, 9, 41)),
        const Duration(minutes: 10),
      );
      expect(
        CodeTiming.remaining(expires, DateTime(2026, 10, 4, 9, 52)),
        Duration.zero,
      );
    });

    test('is expired from the expiry instant on', () {
      expect(
        CodeTiming.isExpired(expires, DateTime(2026, 10, 4, 9, 50, 59)),
        isFalse,
      );
      expect(CodeTiming.isExpired(expires, expires), isTrue);
      expect(
        CodeTiming.isExpired(expires, expires.add(const Duration(seconds: 1))),
        isTrue,
      );
    });

    test('formats mm:ss, rounding seconds up', () {
      expect(CodeTiming.format(const Duration(minutes: 10)), '10:00');
      expect(
        CodeTiming.format(const Duration(minutes: 9, seconds: 59)),
        '09:59',
      );
      expect(CodeTiming.format(const Duration(milliseconds: 200)), '00:01');
      expect(CodeTiming.format(Duration.zero), '00:00');
    });

    test('speaks whole minutes, rounded up', () {
      expect(
        CodeTiming.minutesLeft(const Duration(minutes: 9, seconds: 1)),
        10,
      );
      expect(CodeTiming.minutesLeft(const Duration(seconds: 40)), 1);
    });

    test('the window is the spec value of 10 minutes', () {
      expect(CodeTiming.window, const Duration(minutes: 10));
    });
  });

  group('ActiveCode', () {
    test('reads the server expiry in local time', () {
      final reservation = sampleReservation().copyWith(
        expiresAt: DateTime.parse('2026-10-04T09:51:00+03:00'),
      );
      final code = ActiveCode(reservation: reservation, shopSlug: sampleSlug);
      expect(code.expiresAt.isUtc, isFalse);
      expect(code.expiresAt, reservation.expiresAt.toLocal());
      expect(code.code, 'K7M2QX9R');
    });
  });

  group('safeReturnLocation', () {
    test('keeps recipient locations', () {
      expect(
        safeReturnLocation('/recipient/reserve/ornek/item-1'),
        '/recipient/reserve/ornek/item-1',
      );
      expect(safeReturnLocation('/recipient/code'), '/recipient/code');
      expect(safeReturnLocation('/recipient'), '/recipient');
    });

    test('sends everything else to the recipient home', () {
      for (final from in [
        null,
        '',
        'https://evil.example/recipient/code',
        '//evil.example/recipient',
        '/donor/donate/x',
        '/merchant/redemptions',
        '/recipientx',
        '/recipient/start?from=/recipient/code',
        '/recipient/../merchant',
      ]) {
        expect(safeReturnLocation(from), '/recipient', reason: '$from');
      }
    });
  });

  group('RecipientPaths', () {
    test('reserve and code are protected by the anon guard', () {
      expect(
        requirementOf(RecipientPaths.reserve(sampleSlug, breadItemId)),
        RouteRequirement.anon,
      );
      expect(requirementOf(RecipientPaths.code), RouteRequirement.anon);
      expect(
        requirementOf(RecipientPaths.shop(sampleSlug)),
        RouteRequirement.none,
      );
      expect(RecipientPaths.start, '/recipient/start');
    });

    test('encodes path parts', () {
      expect(
        RecipientPaths.reserve('a b', 'x/y'),
        '/recipient/reserve/a%20b/x%2Fy',
      );
    });
  });

  group('search area', () {
    final shops = FakeShopsRepository.sampleShops();

    test('radius is 3 km by default and 5 km at most', () {
      expect(RecipientRadius.initial, 3000);
      expect(RecipientRadius.max, 5000);
    });

    test('a picked district decides the impact area', () {
      final district = kPickerDistricts.firstWhere((d) => d.ilce == 'Çankaya');
      final location = CoarseLocationState(
        point: district.center,
        source: LocationSource.district,
        district: district,
      );
      expect(
        impactAreaFor(location, shops),
        const ImpactArea(il: 'Ankara', ilce: 'Çankaya'),
      );
    });

    test('otherwise the nearest listed shop, otherwise the country', () {
      const location = CoarseLocationState(
        point: GeoPoint(lat: 41.06, lng: 28.99),
        source: LocationSource.device,
      );
      expect(
        impactAreaFor(location, shops.reversed.toList()),
        const ImpactArea(il: 'İstanbul', ilce: 'Şişli'),
      );
      expect(impactAreaFor(location, const []), const ImpactArea());
    });

    test('counts items on the rail across shops', () {
      expect(availableTotal(shops), 12);
      expect(availableTotal([shops.first.copyWith(availableCount: -3)]), 0);
    });

    test('queries compare by value', () {
      const a = NearbyQuery(GeoPoint(lat: 41.06, lng: 28.99), 3000);
      const b = NearbyQuery(GeoPoint(lat: 41.06, lng: 28.99), 3000);
      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(
        a == const NearbyQuery(GeoPoint(lat: 41.06, lng: 28.99), 5000),
        isFalse,
      );
    });
  });
}
