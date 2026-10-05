import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/rail_counter.dart';
import 'package:askida/features/impact/impact_providers.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Copy of the methodology key the server sends (`impact.v1.daily_units`);
/// an unknown key gets the general line, never the raw key.
String impactMethodologyText(AppLocalizations l10n, String key) =>
    switch (key) {
      'impact.v1.daily_units' => l10n.impactMethodologyDailyUnits,
      _ => l10n.impactMethodologyGeneric,
    };

/// Name of the area the numbers describe.
String impactAreaLabel(AppLocalizations l10n, ImpactSummary summary) =>
    switch (summary.level) {
      ImpactLevel.ilce when summary.ilce != null && summary.il != null =>
        '${summary.ilce}, ${summary.il}',
      ImpactLevel.il when summary.il != null => summary.il!,
      _ => l10n.impactAreaCountry,
    };

/// The impact card: today's units on the rail in an area (the rail counter),
/// units taken and shops taking part, the dated methodology line and, for a
/// signed-in donor, their own numbers. Items are counted, never people;
/// there is no goal and no percentage.
class ImpactCard extends StatelessWidget {
  const new({required this.summary, this.donor, super.key});

  final ImpactSummary summary;
  final DonorImpact? donor;

  static const List<FontFeature> _figures = [
    FontFeature.tabularFigures(),
    FontFeature.liningFigures(),
  ];

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final theme = Theme.of(context);
    final mine = donor;
    final day = DateTime.tryParse(summary.day);
    final dayText = day == null
        ? summary.day
        : DateFormat.yMMMMd(l10n.localeName).format(day);
    Widget figure(String key, int value, String caption) => Expanded(
      child: Semantics(
        key: ValueKey(key),
        label: '$value $caption',
        excludeSemantics: true,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '$value',
              style: AskidaTypography.numeral.copyWith(color: c.text),
            ),
            Text(
              caption,
              style: AskidaTypography.footnote.copyWith(color: c.textMuted),
            ),
          ],
        ),
      ),
    );
    // The rail counter brings its own surface; the rest sits on the
    // screen ground (no card inside a card).
    return SizedBox(
      key: const ValueKey('impact-card'),
      width: double.infinity,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.impactCardTitle(impactAreaLabel(l10n, summary)),
            style: theme.textTheme.titleMedium,
          ),
          const SizedBox(height: AskidaSpacing.s3),
          RailCounter(
            count: summary.donated,
            lead: l10n.impactCounterLead,
            tail: l10n.impactCounterTail,
          ),
          const SizedBox(height: AskidaSpacing.s4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              figure('impact-redeemed', summary.redeemed, l10n.impactRedeemed),
              const SizedBox(width: AskidaSpacing.s4),
              figure('impact-shops', summary.shops, l10n.impactShops),
            ],
          ),
          if (mine != null) ...[
            const SizedBox(height: AskidaSpacing.s4),
            Divider(height: 1, color: c.border),
            const SizedBox(height: AskidaSpacing.s4),
            Semantics(
              key: const ValueKey('impact-mine'),
              label: l10n.impactMine(mine.units, mine.shops),
              excludeSemantics: true,
              child: Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: '${mine.units} ',
                      style: theme.textTheme.titleMedium?.copyWith(
                        color: c.accentText,
                        fontFeatures: _figures,
                      ),
                    ),
                    TextSpan(
                      text: l10n.impactMineTail(mine.units, mine.shops),
                      style: theme.textTheme.bodyMedium,
                    ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: AskidaSpacing.s3),
          Text(
            '${impactMethodologyText(l10n, summary.methodology)} · $dayText',
            style: AskidaTypography.footnote.copyWith(color: c.textMuted),
          ),
        ],
      ),
    );
  }
}
