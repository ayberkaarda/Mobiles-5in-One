import 'package:askida/data/models/shop.dart';
import 'package:askida/features/discovery/data/location_service.dart';

/// Scriptable [LocationService]: set [permissionState], [afterRequest],
/// [position] (null = no fix).
class FakeLocationService implements LocationService {
  new({
    this.permissionState = LocationPermissionState.unknown,
    this.afterRequest = LocationPermissionState.granted,
    this.position = const GeoPoint(lat: 41.063217, lng: 28.992841),
  });

  LocationPermissionState permissionState;
  LocationPermissionState afterRequest;
  GeoPoint? position;

  int requests = 0;
  final List<bool> preciseCalls = [];

  @override
  Future<LocationPermissionState> permission() async => permissionState;

  @override
  Future<LocationPermissionState> request() async {
    requests++;
    permissionState = afterRequest;
    return afterRequest;
  }

  @override
  Future<GeoPoint> current({required bool precise}) async {
    preciseCalls.add(precise);
    final point = position;
    if (point == null) throw StateError('no fix');
    return point;
  }
}
