import 'package:askida/data/models/shop.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:flutter/foundation.dart';

/// Search radius of the recipient list (spec: 3 km by default, 5 km max).
abstract final class RecipientRadius {
  static const int initial = 3000;
  static const int max = 5000;
}

/// One nearby query: the coarse point and the radius.
@immutable
class NearbyQuery {
  const new(this.point, this.radiusM);

  /// Always a two-decimal point (see `coarsen`).
  final GeoPoint point;
  final int radiusM;

  @override
  bool operator ==(Object other) =>
      other is NearbyQuery && other.point == point && other.radiusM == radiusM;

  @override
  int get hashCode => Object.hash(point, radiusM);
}

/// Area the impact numbers are asked for.
@immutable
class ImpactArea {
  const new({this.il, this.ilce});

  final String? il;
  final String? ilce;

  @override
  bool operator ==(Object other) =>
      other is ImpactArea && other.il == il && other.ilce == ilce;

  @override
  int get hashCode => Object.hash(il, ilce);
}

/// The picked district when there is one; otherwise the district of the
/// nearest listed shop (the server already knows where shops are, so this
/// reveals nothing new); otherwise the whole country.
ImpactArea impactAreaFor(
  CoarseLocationState location,
  List<ShopSummary> shops,
) {
  final district = location.district;
  if (district != null) return ImpactArea(il: district.il, ilce: district.ilce);
  if (shops.isEmpty) return const ImpactArea();
  final nearest = shops.reduce(
    (a, b) => (a.distanceM ?? 1 << 30) <= (b.distanceM ?? 1 << 30) ? a : b,
  );
  return ImpactArea(il: nearest.il, ilce: nearest.ilce);
}

/// Items on the rail across [shops] (negative counts are treated as zero).
int availableTotal(List<ShopSummary> shops) => shops.fold(
  0,
  (sum, shop) => sum + (shop.availableCount < 0 ? 0 : shop.availableCount),
);
