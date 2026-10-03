import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/widgets/rail_counter.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

class RecipientHomeScreen extends StatelessWidget {
  const new({super.key});

  /// Sample value shown on the rail counter until real counts exist; it is
  /// always rendered with the sample label.
  static const int sampleRailCount = 12;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(AskidaLayout.screenGutter),
      children: [
        RailCounter(
          count: sampleRailCount,
          lead: l10n.recipientCounterLead,
          tail: l10n.recipientCounterTail,
          sampleLabel: l10n.sampleLabel,
        ),
        const SizedBox(height: AskidaSpacing.s8),
        Text(
          l10n.recipientEmptyTitle,
          style: theme.textTheme.headlineSmall,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: AskidaSpacing.s3),
        Text(
          l10n.recipientEmptyBody,
          style: theme.textTheme.bodyLarge?.copyWith(
            color: AskidaColors.of(context).textMuted,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }
}
