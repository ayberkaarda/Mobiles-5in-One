import 'package:askida/data/models/shop.dart';
import 'package:flutter/foundation.dart';

/// A district a recipient can pick instead of sharing the device location.
@immutable
class District {
  const new(this.il, this.ilce, this.center);

  final String il;
  final String ilce;

  /// Approximate centre, already at two decimals (about 1 km).
  final GeoPoint center;

  String get label => '$ilce, $il';

  @override
  bool operator ==(Object other) =>
      other is District && other.il == il && other.ilce == ilce;

  @override
  int get hashCode => Object.hash(il, ilce);
}

/// The fallback picker's list: a few central districts of İstanbul, Ankara
/// and İzmir with approximate centres. Not a gazetteer; the server decides
/// which shops are near.
const List<District> kPickerDistricts = [
  District('İstanbul', 'Bakırköy', GeoPoint(lat: 40.98, lng: 28.87)),
  District('İstanbul', 'Beşiktaş', GeoPoint(lat: 41.04, lng: 29.01)),
  District('İstanbul', 'Fatih', GeoPoint(lat: 41.02, lng: 28.94)),
  District('İstanbul', 'Kadıköy', GeoPoint(lat: 40.99, lng: 29.03)),
  District('İstanbul', 'Şişli', GeoPoint(lat: 41.06, lng: 28.99)),
  District('İstanbul', 'Üsküdar', GeoPoint(lat: 41.02, lng: 29.02)),
  District('Ankara', 'Çankaya', GeoPoint(lat: 39.92, lng: 32.85)),
  District('Ankara', 'Keçiören', GeoPoint(lat: 39.98, lng: 32.87)),
  District('Ankara', 'Mamak', GeoPoint(lat: 39.93, lng: 32.91)),
  District('Ankara', 'Yenimahalle', GeoPoint(lat: 39.97, lng: 32.81)),
  District('İzmir', 'Bornova', GeoPoint(lat: 38.47, lng: 27.22)),
  District('İzmir', 'Buca', GeoPoint(lat: 38.39, lng: 27.18)),
  District('İzmir', 'Karşıyaka', GeoPoint(lat: 38.46, lng: 27.11)),
  District('İzmir', 'Konak', GeoPoint(lat: 38.42, lng: 27.13)),
];

/// Provinces of [kPickerDistricts] in list order.
List<String> pickerProvinces() =>
    {for (final d in kPickerDistricts) d.il}.toList();

/// Rounds to two decimals (about 1.1 km): the only precision a recipient
/// location ever leaves the device with.
GeoPoint coarsen(GeoPoint point) =>
    GeoPoint(lat: _round2(point.lat), lng: _round2(point.lng));

double _round2(double value) => (value * 100).round() / 100;
