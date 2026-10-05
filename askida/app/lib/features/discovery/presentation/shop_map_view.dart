import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/features/discovery/presentation/map_tiles.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

/// Shops on a map. Tiles come from [buildTileLayer] with the provider from
/// `tileProviderProvider`; attribution is always shown. A marker is a tag:
/// accent when something is on the rail, quiet when nothing is.
class ShopMapView extends ConsumerWidget {
  const new({
    required this.center,
    required this.shops,
    this.zoom = 14,
    this.onShopTap,
    super.key,
  });

  final GeoPoint center;
  final List<ShopSummary> shops;
  final double zoom;
  final ValueChanged<ShopSummary>? onShopTap;

  static const double markerWidth = 40;
  static const double markerHeight = 52;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tiles = ref.watch(tileProviderProvider);
    return FlutterMap(
      options: MapOptions(
        initialCenter: LatLng(center.lat, center.lng),
        initialZoom: zoom,
        minZoom: 5,
        maxZoom: 18,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
        ),
      ),
      children: [
        buildTileLayer(tiles),
        MarkerLayer(
          markers: [
            for (final shop in shops)
              Marker(
                key: ValueKey('marker-${shop.id}'),
                point: LatLng(shop.location.lat, shop.location.lng),
                width: markerWidth,
                height: markerHeight,
                alignment: Alignment.topCenter,
                child: ShopMarker(
                  shop: shop,
                  onTap: onShopTap == null ? null : () => onShopTap!(shop),
                ),
              ),
          ],
        ),
        const MapAttribution(),
      ],
    );
  }
}

/// The map marker of one shop, in the `AskidaTag` look.
class ShopMarker extends StatelessWidget {
  const new({required this.shop, this.onTap, super.key});

  final ShopSummary shop;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final count = shop.availableCount;
    final hasItems = count > 0;
    return Semantics(
      button: onTap != null,
      label: context.l10n.mapShopMarkerLabel(shop.name, count),
      excludeSemantics: true,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: AskidaTag(
          width: ShopMapView.markerWidth - 8,
          height: ShopMapView.markerHeight - 8,
          tone: hasItems ? AskidaTagTone.accent : AskidaTagTone.secondary,
          child: Text(
            hasItems ? '$count' : '—',
            style: AskidaTypography.caption.copyWith(
              fontWeight: FontWeight.w600,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
        ),
      ),
    );
  }
}
