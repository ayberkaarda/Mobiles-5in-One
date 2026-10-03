import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/design/widgets/sample_chip.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// The six item categories. Glyphs are interim Material outlines until the
/// brand pictograms are available to the app; none shows a person.
enum ShopCategory {
  ekmek(Icons.bakery_dining_outlined),
  corba(Icons.soup_kitchen_outlined),
  yemek(Icons.restaurant_outlined),
  kirtasiye(Icons.edit_outlined),
  bebek(Icons.child_friendly_outlined),
  diger(Icons.category_outlined);

  new(this.icon);

  final IconData icon;

  String label(AppLocalizations l10n) => switch (this) {
    ShopCategory.ekmek => l10n.categoryEkmek,
    ShopCategory.corba => l10n.categoryCorba,
    ShopCategory.yemek => l10n.categoryYemek,
    ShopCategory.kirtasiye => l10n.categoryKirtasiye,
    ShopCategory.bebek => l10n.categoryBebek,
    ShopCategory.diger => l10n.categoryDiger,
  };
}

/// "450 m" under a kilometre, "1,2 km" (locale decimal separator) above.
String formatDistance(AppLocalizations l10n, int meters) {
  if (meters < 1000) return l10n.shopDistanceMeters(meters);
  final km = NumberFormat('0.#', l10n.localeName).format(meters / 1000);
  return l10n.shopDistanceKm(km);
}

/// A shop row on the rail list.
class ShopCard extends StatelessWidget {
  const new({
    required this.name,
    required this.district,
    required this.distanceMeters,
    required this.category,
    required this.availableCount,
    this.verified = false,
    this.isSample = false,
    this.onTap,
    super.key,
  }) : assert(availableCount >= 0, 'count is a number of items');

  /// Shop name as stored; sample shops already carry the `[ÖRNEK]` prefix.
  final String name;
  final String district;
  final int distanceMeters;
  final ShopCategory category;

  /// Items on the shop's rail today.
  final int availableCount;
  final bool verified;
  final bool isSample;
  final VoidCallback? onTap;

  static const List<FontFeature> _figures = [
    FontFeature.tabularFigures(),
    FontFeature.liningFigures(),
  ];

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final hasItems = availableCount > 0;
    final meta = AskidaTypography.footnote.copyWith(color: c.textMuted);

    return Material(
      color: c.surface,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(AskidaRadius.row)),
        side: BorderSide(color: c.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 72),
          child: Padding(
            padding: const EdgeInsets.all(AskidaSpacing.s4),
            child: Row(
              children: [
                AskidaTag(
                  width: 40,
                  height: 48,
                  tone: hasItems
                      ? AskidaTagTone.accent
                      : AskidaTagTone.secondary,
                  semanticLabel: category.label(l10n),
                  child: Icon(category.icon, size: 20),
                ),
                const SizedBox(width: AskidaSpacing.s3),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        name,
                        style: AskidaTypography.title2.copyWith(color: c.text),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (isSample) ...[
                        const SizedBox(height: AskidaSpacing.s1),
                        SampleChip(label: l10n.sampleLabel),
                      ],
                      const SizedBox(height: 2),
                      Text(
                        '$district · ${formatDistance(l10n, distanceMeters)}',
                        style: meta.copyWith(fontFeatures: _figures),
                      ),
                      if (verified)
                        Row(
                          children: [
                            Icon(Icons.check, size: 16, color: c.success),
                            const SizedBox(width: AskidaSpacing.s1),
                            Flexible(
                              child: Text(
                                l10n.shopVerified,
                                style: AskidaTypography.footnote.copyWith(
                                  color: c.success,
                                ),
                              ),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
                const SizedBox(width: AskidaSpacing.s3),
                Semantics(
                  label: hasItems
                      ? '$availableCount ${l10n.shopAvailableCaption}'
                      : l10n.shopNoneAvailable,
                  excludeSemantics: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        hasItems ? '$availableCount' : '—',
                        key: const ValueKey('shop-card-count'),
                        style: AskidaTypography.numeral.copyWith(color: c.text),
                      ),
                      Text(
                        l10n.shopAvailableCaption,
                        style: AskidaTypography.caption.copyWith(
                          color: c.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
