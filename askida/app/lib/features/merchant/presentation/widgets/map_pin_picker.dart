import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/discovery/domain/districts.dart';
import 'package:askida/features/discovery/presentation/map_tiles.dart';
import 'package:askida/features/discovery/presentation/shop_map_view.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

/// Where the map opens when no pin is set: the picker district matching
/// the typed il/ilçe, else central İstanbul.
GeoPoint initialMapCenter({required String il, required String ilce}) {
  for (final district in kPickerDistricts) {
    if (district.il == il.trim() && district.ilce == ilce.trim()) {
      return district.center;
    }
  }
  return const GeoPoint(lat: 41.01, lng: 28.97);
}

/// Map on which the owner taps the shop's position. "Konumumu kullan" may
/// read the device position (merchants may share their shop's precise
/// location; recipients never do), after a short rationale.
class MapPinPicker extends ConsumerStatefulWidget {
  const new({
    required this.pin,
    required this.center,
    required this.onChanged,
    super.key,
  });

  final GeoPoint? pin;
  final GeoPoint center;
  final ValueChanged<GeoPoint> onChanged;

  static const double height = 240;

  @override
  ConsumerState<MapPinPicker> createState() => _MapPinPickerState();
}

class _MapPinPickerState extends ConsumerState<MapPinPicker> {
  final MapController _map = MapController();
  bool _locating = false;
  bool _locationFailed = false;

  @override
  void dispose() {
    _map.dispose();
    super.dispose();
  }

  void _set(GeoPoint point, {bool move = false}) {
    widget.onChanged(point);
    if (move) {
      try {
        _map.move(LatLng(point.lat, point.lng), 17);
      } on Object {
        // The map is not laid out yet; the pin still shows once it is.
      }
    }
  }

  Future<void> _useLocation() async {
    final service = ref.read(locationServiceProvider);
    final l10n = context.l10n;
    setState(() {
      _locating = true;
      _locationFailed = false;
    });
    try {
      var permission = await service.permission();
      if (permission == LocationPermissionState.unknown ||
          permission == LocationPermissionState.denied) {
        if (!mounted) return;
        final go = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(l10n.merchantLocationRationaleTitle),
            content: Text(l10n.merchantLocationRationaleBody),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: Text(l10n.merchantCancel),
              ),
              FilledButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: Text(l10n.merchantContinue),
              ),
            ],
          ),
        );
        if (go != true) return;
        permission = await service.request();
      }
      if (permission != LocationPermissionState.granted) {
        if (mounted) setState(() => _locationFailed = true);
        return;
      }
      final point = await service.current(precise: true);
      if (mounted) _set(point, move: true);
    } on Object {
      if (mounted) setState(() => _locationFailed = true);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final pin = widget.pin;
    final tiles = ref.watch(tileProviderProvider);
    final start = pin ?? widget.center;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          label: l10n.merchantMapLabel,
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AskidaRadius.card),
            child: SizedBox(
              key: const ValueKey('map-pin-picker'),
              height: MapPinPicker.height,
              child: FlutterMap(
                mapController: _map,
                options: MapOptions(
                  initialCenter: LatLng(start.lat, start.lng),
                  initialZoom: pin == null ? 13 : 17,
                  minZoom: 5,
                  maxZoom: 19,
                  interactionOptions: const InteractionOptions(
                    flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                  ),
                  onTap: (_, point) =>
                      _set(GeoPoint(lat: point.latitude, lng: point.longitude)),
                ),
                children: [
                  buildTileLayer(tiles),
                  if (pin != null)
                    MarkerLayer(
                      markers: [
                        Marker(
                          key: const ValueKey('shop-pin'),
                          point: LatLng(pin.lat, pin.lng),
                          width: ShopMapView.markerWidth,
                          height: ShopMapView.markerHeight,
                          alignment: Alignment.topCenter,
                          child: const AskidaTag(width: 28, height: 36),
                        ),
                      ],
                    ),
                  const MapAttribution(),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(height: AskidaSpacing.s2),
        Text(
          pin == null
              ? l10n.merchantMapHint
              : l10n.merchantMapPinned(
                  pin.lat.toStringAsFixed(5),
                  pin.lng.toStringAsFixed(5),
                ),
          style: Theme.of(context).textTheme.bodySmall
              ?.copyWith(color: c.textMuted),
        ),
        if (_locationFailed)
          Text(
            l10n.merchantLocationFailed,
            style: Theme.of(context).textTheme.bodySmall
                ?.copyWith(color: c.dangerText),
          ),
        const SizedBox(height: AskidaSpacing.s2),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: FilledButton.tonalIcon(
            onPressed: _locating ? null : _useLocation,
            icon: const Icon(Icons.my_location),
            label: Text(l10n.merchantUseMyLocation),
          ),
        ),
      ],
    );
  }
}
