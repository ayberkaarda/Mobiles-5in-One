import 'package:askida/design/theme.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';

/// The single tile source (ADR-0003): a keyless OSM-compatible template.
/// Switching to a self-hosted PMTiles archive changes only this file.
const String kTileUrlTemplate =
    'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/// Identifies the app to the tile server (its usage policy asks for it).
const String kTileUserAgentPackage = 'app.askida.mobile';

/// The ONE tile-layer factory. [provider] is the test seam
/// (`tileProviderProvider` in `lib/data/providers.dart`).
TileLayer buildTileLayer(TileProvider provider) => TileLayer(
  urlTemplate: kTileUrlTemplate,
  userAgentPackageName: kTileUserAgentPackage,
  tileProvider: provider,
);

/// Attribution required by the tile data, shown on every map (bottom
/// right, one line, never overflowing at narrow widths or large text).
class MapAttribution extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    return Align(
      alignment: Alignment.bottomRight,
      child: SafeArea(
        child: Container(
          margin: const EdgeInsets.all(4),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
          color: c.surface.withValues(alpha: 0.85),
          child: Text(
            '© ${context.l10n.mapAttribution}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AskidaTypography.caption.copyWith(color: c.textMuted),
          ),
        ),
      ),
    );
  }
}
