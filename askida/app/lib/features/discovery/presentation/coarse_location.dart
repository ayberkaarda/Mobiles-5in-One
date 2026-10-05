import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/discovery/domain/districts.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum LocationSource { none, device, district }

/// Where the recipient list is centred. [point] is always rounded to two
/// decimals; a precise recipient position never exists in state.
@immutable
class CoarseLocationState {
  const new({
    this.point,
    this.source = LocationSource.none,
    this.district,
    this.permission = LocationPermissionState.unknown,
    this.failed = false,
  });

  final GeoPoint? point;
  final LocationSource source;
  final District? district;
  final LocationPermissionState permission;

  /// The device had permission but no position could be read.
  final bool failed;

  /// Show the rationale (and then [CoarseLocationController.requestAndLocate]).
  bool get needsRationale =>
      point == null &&
      (permission == LocationPermissionState.unknown ||
          permission == LocationPermissionState.denied);

  /// Asking again is pointless: offer the district picker.
  bool get offerDistricts =>
      point == null &&
      (failed ||
          permission == LocationPermissionState.deniedForever ||
          permission == LocationPermissionState.serviceDisabled);

  CoarseLocationState copyWith({
    GeoPoint? point,
    LocationSource? source,
    District? district,
    bool clearDistrict = false,
    LocationPermissionState? permission,
    bool? failed,
  }) => CoarseLocationState(
    point: point ?? this.point,
    source: source ?? this.source,
    district: clearDistrict ? null : district ?? this.district,
    permission: permission ?? this.permission,
    failed: failed ?? this.failed,
  );
}

/// Recipient location: device position rounded to two decimals, or a
/// district picked from [kPickerDistricts].
class CoarseLocationController extends Notifier<CoarseLocationState> {
  @override
  CoarseLocationState build() => const CoarseLocationState();

  LocationService get _service => ref.read(locationServiceProvider);

  /// Reads the permission; locates only when it is already granted.
  Future<void> check() async {
    final permission = await _service.permission();
    state = state.copyWith(permission: permission);
    if (permission == LocationPermissionState.granted) await _locate();
  }

  /// After the rationale: asks the system, then locates when granted.
  Future<void> requestAndLocate() async {
    final permission = await _service.request();
    state = state.copyWith(permission: permission);
    if (permission == LocationPermissionState.granted) await _locate();
  }

  Future<void> _locate() async {
    try {
      final precise = await _service.current(precise: false);
      state = state.copyWith(
        point: coarsen(precise),
        source: LocationSource.device,
        clearDistrict: true,
        failed: false,
      );
    } on Object {
      state = state.copyWith(failed: true);
    }
  }

  void chooseDistrict(District district) {
    state = state.copyWith(
      point: coarsen(district.center),
      source: LocationSource.district,
      district: district,
    );
  }

  void clear() => state = CoarseLocationState(permission: state.permission);
}

final coarseLocationProvider =
    NotifierProvider<CoarseLocationController, CoarseLocationState>(
      CoarseLocationController.new,
    );
