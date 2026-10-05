import 'package:askida/data/models/donation.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/discovery/domain/districts.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart';

/// Where the donor's shop list is centred: the device position (donors may
/// share it, when in use, after the rationale; nothing is asked before the
/// donor taps "Konumu kullan") or a picked district.
@immutable
class DonorLocationState {
  const new({
    this.point,
    this.district,
    this.permission = LocationPermissionState.unknown,
    this.failed = false,
  });

  final GeoPoint? point;
  final District? district;
  final LocationPermissionState permission;

  /// Permission was granted but no position could be read.
  final bool failed;

  bool get offerDistrictsOnly =>
      point == null &&
      (failed ||
          permission == LocationPermissionState.deniedForever ||
          permission == LocationPermissionState.serviceDisabled);
}

class DonorLocationController extends Notifier<DonorLocationState> {
  @override
  DonorLocationState build() => const DonorLocationState();

  LocationService get _service => ref.read(locationServiceProvider);

  /// After the rationale: the system dialog, then the position. A platform
  /// without location support ends in the district picker.
  Future<void> requestAndLocate() async {
    LocationPermissionState permission;
    try {
      permission = await _service.request();
    } on Object {
      permission = LocationPermissionState.serviceDisabled;
    }
    state = DonorLocationState(permission: permission);
    if (permission != LocationPermissionState.granted) return;
    try {
      final point = await _service.current(precise: true);
      state = DonorLocationState(point: point, permission: permission);
    } on Object {
      state = DonorLocationState(permission: permission, failed: true);
    }
  }

  void chooseDistrict(District district) => state = DonorLocationState(
    point: district.center,
    district: district,
    permission: state.permission,
  );
}

final donorLocationProvider =
    NotifierProvider<DonorLocationController, DonorLocationState>(
      DonorLocationController.new,
    );

/// Shops near a point: the cached list first (offline), then the network.
final StreamProviderFamily<ShopPage, GeoPoint> donorNearbyShopsProvider =
    StreamProvider.autoDispose.family<ShopPage, GeoPoint>(
      (ref, point) => ref
          .watch(cachedShopsRepositoryProvider)
          .watchNearby(point.lat, point.lng, radiusM: 5000),
      retry: _noRetry,
    );

/// One shop by slug (public detail; the cache serves it offline).
final FutureProviderFamily<ShopDetails, String> donorShopProvider =
    FutureProvider.autoDispose.family<ShopDetails, String>(
      (ref, slug) => ref.watch(shopsRepositoryProvider).bySlug(slug),
      retry: _noRetry,
    );

/// The donor's donations, newest first. Pages are loaded on demand by
/// [DonationHistoryController.loadMore].
@immutable
class DonationHistory {
  const new({
    this.donations = const [],
    this.nextCursor,
    this.loadingMore = false,
  });

  final List<Donation> donations;
  final String? nextCursor;
  final bool loadingMore;

  bool get hasMore => nextCursor != null;
}

class DonationHistoryController extends AsyncNotifier<DonationHistory> {
  @override
  Future<DonationHistory> build() async {
    final page = await ref.watch(donationsRepositoryProvider).list();
    return DonationHistory(
      donations: page.donations,
      nextCursor: page.nextCursor,
    );
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || current.loadingMore) return;
    state = AsyncData(
      DonationHistory(
        donations: current.donations,
        nextCursor: current.nextCursor,
        loadingMore: true,
      ),
    );
    try {
      final page = await ref
          .read(donationsRepositoryProvider)
          .list(cursor: current.nextCursor);
      state = AsyncData(
        DonationHistory(
          donations: [...current.donations, ...page.donations],
          nextCursor: page.nextCursor,
        ),
      );
    } on Object {
      // Keep what is shown; the "more" row offers another try.
      state = AsyncData(current);
    }
  }
}

final AsyncNotifierProvider<DonationHistoryController, DonationHistory>
donationHistoryProvider =
    AsyncNotifierProvider.autoDispose<
      DonationHistoryController,
      DonationHistory
    >(DonationHistoryController.new, retry: _noRetry);

/// One donation, re-read from the server (the receipt never trusts the
/// status of the return link).
final FutureProviderFamily<Donation, String> donationProvider = FutureProvider
    .autoDispose
    .family<Donation, String>(
      (ref, id) => ref.watch(donationsRepositoryProvider).byId(id),
      retry: _noRetry,
    );

/// Failed loads are not retried behind the user's back (a rate limit or a
/// missing record would only be hit again); every screen offers a retry.
Duration? _noRetry(int retryCount, Object error) => null;
