import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

/// The station rail: three tags on one rail, Bırak -> Askıda -> Al. Only the
/// middle tag carries the accent (something is hanging there).
class StationRail extends StatelessWidget {
  const new({super.key});

  static const double tagWidth = 44;
  static const double tagHeight = 56;
  static const double tieLength = 12;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final stations = [
      (l10n.recipientStationLeave, AskidaTagTone.surface),
      (l10n.recipientStationHang, AskidaTagTone.accent),
      (l10n.recipientStationTake, AskidaTagTone.surface),
    ];
    return Semantics(
      label: l10n.recipientStationLabel,
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(height: AskidaStroke.rail, color: c.text),
          Row(
            children: [
              for (final (label, tone) in stations)
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: AskidaStroke.rail,
                        height: tieLength,
                        color: c.text,
                      ),
                      AskidaTag(width: tagWidth, height: tagHeight, tone: tone),
                      const SizedBox(height: AskidaSpacing.s2),
                      Text(
                        label,
                        style: AskidaTypography.label.copyWith(color: c.text),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
