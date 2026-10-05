import 'package:askida/data/models/shop.dart';
import 'package:geolocator/geolocator.dart';

/// Location permission as the screens need it.
enum LocationPermissionState {
  /// Not asked yet: show the rationale first.
  unknown,
  granted,

  /// Refused once; asking again is allowed.
  denied,

  /// Refused for good: only the district picker remains.
  deniedForever,

  /// Location services are off on the device.
  serviceDisabled,
}

/// Device location behind an interface (tests use a fake).
abstract interface class LocationService {
  Future<LocationPermissionState> permission();

  /// Shows the system dialog (call after the rationale screen).
  Future<LocationPermissionState> request();

  /// Current position. Recipients ask with [precise] false; their point is
  /// rounded before it is used anyway. Throws when no fix is available.
  Future<GeoPoint> current({required bool precise});
}

/// [LocationService] over `geolocator` (when-in-use only).
class GeolocatorLocationService implements LocationService {
  const new();

  static LocationPermissionState _map(LocationPermission permission) =>
      switch (permission) {
        LocationPermission.always ||
        LocationPermission.whileInUse => LocationPermissionState.granted,
        LocationPermission.denied => LocationPermissionState.denied,
        LocationPermission.deniedForever =>
          LocationPermissionState.deniedForever,
        LocationPermission.unableToDetermine => LocationPermissionState.unknown,
      };

  @override
  Future<LocationPermissionState> permission() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return LocationPermissionState.serviceDisabled;
    }
    final permission = await Geolocator.checkPermission();
    // Android reports "denied" before the first request; the app treats it
    // as not asked so the rationale is shown once.
    return permission == LocationPermission.denied
        ? LocationPermissionState.unknown
        : _map(permission);
  }

  @override
  Future<LocationPermissionState> request() async =>
      _map(await Geolocator.requestPermission());

  @override
  Future<GeoPoint> current({required bool precise}) async {
    final position = await Geolocator.getCurrentPosition(
      locationSettings: LocationSettings(
        accuracy: precise ? LocationAccuracy.high : LocationAccuracy.low,
        timeLimit: const Duration(seconds: 15),
      ),
    );
    return GeoPoint(lat: position.latitude, lng: position.longitude);
  }
}
