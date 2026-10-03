import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:flutter/material.dart';

/// Marks sample data: `secondary` fill with `warning` text. The label is the
/// literal `ÖRNEK` from the localisations (never an uppercase transform).
class SampleChip extends StatelessWidget {
  const new({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: c.secondary,
        borderRadius: const BorderRadius.all(
          Radius.circular(AskidaRadius.chip),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AskidaSpacing.s2,
          vertical: 2,
        ),
        child: Text(
          label,
          style: AskidaTypography.caption.copyWith(color: c.warning),
        ),
      ),
    );
  }
}
