import 'package:askida/data/models/impact_summary.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

/// Name of the area an impact summary describes.
String impactAreaLabel(AppLocalizations l10n, ImpactSummary summary) =>
    switch (summary.level) {
      ImpactLevel.ilce => summary.ilce ?? summary.il ?? l10n.recipientImpactTr,
      ImpactLevel.il => summary.il ?? l10n.recipientImpactTr,
      ImpactLevel.tr => l10n.recipientImpactTr,
    };

/// `2026-10-04` as `4 Ekim` (or the raw value when it is not a date).
String impactDayLabel(AppLocalizations l10n, String day) {
  final parsed = DateTime.tryParse(day);
  if (parsed == null) return day;
  return DateFormat.MMMMd(l10n.localeName).format(parsed);
}

/// Today's public counters (read only): units left on the rail, units taken
/// and shops, for the district, province or country. Counts of items and
/// shops only, never of people; no target and no percentage.
class RecipientImpactCard extends StatelessWidget {
  const new({required this.summary, super.key});

  final ImpactSummary summary;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final area = impactAreaLabel(l10n, summary);
    final stats = [
      (summary.donated, l10n.recipientImpactDonated),
      (summary.redeemed, l10n.recipientImpactRedeemed),
      (summary.shops, l10n.recipientImpactShops),
    ];
    return DecoratedBox(
      key: const ValueKey('recipient-impact'),
      decoration: BoxDecoration(
        color: c.surface,
        border: Border.all(color: c.border),
        borderRadius: const BorderRadius.all(
          Radius.circular(AskidaRadius.card),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AskidaSpacing.s4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              l10n.recipientImpactTitle(area),
              style: AskidaTypography.title3.copyWith(color: c.text),
            ),
            const SizedBox(height: AskidaSpacing.s3),
            Wrap(
              spacing: AskidaSpacing.s6,
              runSpacing: AskidaSpacing.s3,
              children: [
                for (final (value, caption) in stats)
                  Semantics(
                    label: '$value $caption',
                    excludeSemantics: true,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '$value',
                          style: AskidaTypography.numeral.copyWith(
                            color: c.text,
                          ),
                        ),
                        Text(
                          caption,
                          style: AskidaTypography.caption.copyWith(
                            color: c.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
            const SizedBox(height: AskidaSpacing.s3),
            Text(
              l10n.recipientImpactNote(impactDayLabel(l10n, summary.day)),
              style: AskidaTypography.footnote.copyWith(color: c.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}
