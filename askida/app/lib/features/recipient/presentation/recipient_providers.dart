import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/data/models/reservation.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:askida/features/recipient/domain/active_code.dart';
import 'package:askida/features/recipient/domain/search_area.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart'
    show FutureProviderFamily, StreamProviderFamily;

/// The first onboarding screen was passed in this run. Kept in memory only:
/// the anonymous flow writes nothing about the person to the device.
class IntroSeenController extends Notifier<bool> {
  @override
  bool build() => false;

  void seen() => state = true;

  void reset() => state = false;
}

final recipientIntroSeenProvider = NotifierProvider<IntroSeenController, bool>(
  IntroSeenController.new,
);

/// Search radius of the list: 3 km, widened once to 5 km on request.
class RadiusController extends Notifier<int> {
  @override
  int build() => RecipientRadius.initial;

  void widen() => state = RecipientRadius.max;

  void reset() => state = RecipientRadius.initial;
}

final recipientRadiusProvider = NotifierProvider<RadiusController, int>(
  RadiusController.new,
);

/// The code this device holds (memory only, at most one).
class ActiveCodeController extends Notifier<ActiveCode?> {
  @override
  ActiveCode? build() => null;

  /// Keeps [reservation] as the device's code for the shop [shopSlug].
  void hold(Reservation reservation, {required String shopSlug}) =>
      state = ActiveCode(reservation: reservation, shopSlug: shopSlug);

  void clear() => state = null;
}

final activeCodeProvider = NotifierProvider<ActiveCodeController, ActiveCode?>(
  ActiveCodeController.new,
);

/// Failures are shown with a retry button at once (calm, predictable);
/// providers here never retry silently in the background.
Duration? _noRetry(int retryCount, Object error) => null;

/// Shops with something on the rail near the coarse point: the cached list
/// first (offline use), then the network list.
final StreamProviderFamily<ShopPage, NearbyQuery> recipientNearbyProvider =
    StreamProvider.autoDispose.family<ShopPage, NearbyQuery>(
      (ref, query) => ref
          .watch(cachedShopsRepositoryProvider)
          .watchNearby(
            query.point.lat,
            query.point.lng,
            radiusM: query.radiusM,
            hasAvailable: true,
          ),
      retry: _noRetry,
    );

/// Shop detail (read-through cache).
final FutureProviderFamily<ShopDetails, String> recipientShopProvider =
    FutureProvider.autoDispose.family<ShopDetails, String>(
      (ref, slug) => ref.watch(shopsRepositoryProvider).bySlug(slug),
      retry: _noRetry,
    );

/// Today's public counters for an area.
final FutureProviderFamily<ImpactSummary, ImpactArea> recipientImpactProvider =
    FutureProvider.autoDispose.family<ImpactSummary, ImpactArea>(
      (ref, area) => ref
          .watch(impactRepositoryProvider)
          .impact(il: area.il, ilce: area.ilce),
      retry: _noRetry,
    );

/// "Verilerimi sıfırla": deletes the anonymous identity on the server
/// (`DELETE anon/me`), the token, the offline cache, the active code and the
/// chosen area.
class RecipientReset {
  new(this._ref);

  final Ref _ref;

  /// True when the server confirmed; false when it could not be reached.
  /// The device data is wiped in both cases.
  Future<bool> run() async {
    var confirmed = true;
    try {
      if (_ref.read(sessionProvider).hasAnonToken) {
        await _ref.read(anonRepositoryProvider).deleteMe();
      } else {
        await _ref.read(localDataEraserProvider)();
      }
    } on ApiProblem {
      confirmed = false;
    }
    _ref.read(activeCodeProvider.notifier).clear();
    _ref.read(coarseLocationProvider.notifier).clear();
    _ref.read(recipientRadiusProvider.notifier).reset();
    _ref.read(recipientIntroSeenProvider.notifier).reset();
    return confirmed;
  }
}

final recipientResetProvider = Provider<RecipientReset>(RecipientReset.new);
