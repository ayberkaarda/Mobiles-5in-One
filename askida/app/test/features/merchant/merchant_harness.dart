import 'package:askida/core/platform/media_picker.dart';
import 'package:askida/core/qr/qr_scanner.dart';
import 'package:askida/core/time/clock.dart';
import 'package:askida/data/db/app_database.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import '../../fakes/fake_auth_repository.dart';
import '../../fakes/fake_hooks_repository.dart';
import '../../fakes/fake_location_service.dart';
import '../../fakes/fake_media_picker.dart';
import '../../fakes/fake_misc_repositories.dart';
import '../../fakes/fake_qr_scanner.dart';
import '../../fakes/fake_shops_repository.dart';
import '../../fakes/fake_tile_provider.dart';
import '../../helpers/test_database.dart';

/// The signed-in merchant of the fixtures.
final User merchantUser = FakeAuthRepository.sampleMerchant();

final SessionState merchantSession = SessionState(
  user: merchantUser,
  hasUserToken: true,
  restored: true,
);

final SessionState donorSession = SessionState(
  user: FakeAuthRepository.sampleDonor(),
  hasUserToken: true,
  restored: true,
);

/// A session controller that starts in [initial] (screen tests pump
/// without the restore step).
class FixedSession extends SessionController {
  new(this.initial);

  final SessionState initial;

  @override
  SessionState build() => initial;
}

/// The fixture shop as the owner sees it.
OwnerShop ownerShop({VerificationState state = VerificationState.pending}) =>
    FakeShopsRepository.sampleOwnerShop().copyWith(verificationState: state);

/// The `GET me/shops` row of [shop] for [role].
MyShop myShopFor(OwnerShop shop, ShopRole role) =>
    MyShop.fromOwnerShop(shop).copyWith(role: role);

/// Every fake a merchant screen touches, wired into provider overrides.
class MerchantHarness {
  new({
    this.session,
    ShopRole? role = ShopRole.owner,
    VerificationState state = VerificationState.pending,
  }) {
    final shop = ownerShop(state: state);
    if (role == ShopRole.owner) shops.ownShop = shop;
    if (role == ShopRole.staff) {
      shops.staffShops = [myShopFor(shop, ShopRole.staff)];
    }
  }

  /// Defaults to the merchant session.
  final SessionState? session;

  final shops = FakeShopsRepository();
  final hooks = FakeHooksRepository();
  final payouts = FakePayoutsRepository();
  final picker = FakeMediaPicker();
  final tiles = FakeTileProvider();
  final location = FakeLocationService();
  final List<FakeQrScanner> scanners = [];

  /// Builds the scanner each redeem screen opens (a [FakeQrScanner] by
  /// default; tests swap in failing ones).
  FakeQrScanner Function() makeScanner = FakeQrScanner.new;

  FakeQrScanner get scanner => scanners.last;

  List<Override> get overrides => [
    sessionProvider.overrideWith(
      () => FixedSession(session ?? merchantSession),
    ),
    shopsRepositoryProvider.overrideWithValue(shops),
    hooksRepositoryProvider.overrideWithValue(hooks),
    payoutsRepositoryProvider.overrideWithValue(payouts),
    mediaPickerProvider.overrideWithValue(picker),
    tileProviderProvider.overrideWithValue(tiles),
    locationServiceProvider.overrideWithValue(location),
    qrScannerFactoryProvider.overrideWithValue(() {
      final scanner = makeScanner();
      scanners.add(scanner);
      return scanner;
    }),
  ];

  /// Overrides for the full app (`pumpAskida` restores the session itself).
  List<Override> get appOverrides => overrides.skip(1).toList();

  /// A container for provider tests, with an in-memory database.
  ProviderContainer container({AppDatabase? database, DateTime? now}) {
    final db = database ?? testDatabase();
    if (database == null) addTearDown(db.close);
    final container = ProviderContainer(
      overrides: [
        ...overrides,
        appDatabaseProvider.overrideWithValue(db),
        clockProvider.overrideWithValue(() => now ?? DateTime(2026, 10, 4, 10)),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }
}

/// Text scale and width combinations every merchant screen must survive.
const List<(double, Size?)> layoutCases = [
  (1.0, null),
  (1.3, null),
  (1.3, Size(320, 640)),
];

/// A Turkish IBAN with correct check digits, computed at run time so no
/// account-shaped literal sits in the repository.
String sampleIban() {
  final account = List.generate(22, (i) => '${i * 7 % 10}').join();
  // "TR" is 29 27 in the mod-97 alphabet; check digits start as 00.
  var remainder = 0;
  for (final unit in '${account}292700'.codeUnits) {
    remainder = (remainder * 10 + unit - 0x30) % 97;
  }
  return 'TR${(98 - remainder).toString().padLeft(2, '0')}$account';
}
