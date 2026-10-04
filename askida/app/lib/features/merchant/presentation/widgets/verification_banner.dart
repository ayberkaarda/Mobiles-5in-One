import 'package:askida/data/models/shop.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

/// The shop's verification state for its owner: pending (in review),
/// verified (listed) or rejected (fix and send again). Plain surface with a
/// hairline; only the verified check carries colour (`success`).
class VerificationBanner extends StatelessWidget {
  const new({required this.state, super.key});

  final VerificationState state;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final (icon, color, title, body) = switch (state) {
      VerificationState.pending => (
        Icons.hourglass_empty,
        c.info,
        l10n.merchantStatePendingTitle,
        l10n.merchantStatePendingBody,
      ),
      VerificationState.verified => (
        Icons.check,
        c.success,
        l10n.merchantStateVerifiedTitle,
        l10n.merchantStateVerifiedBody,
      ),
      VerificationState.rejected => (
        Icons.error_outline,
        c.dangerText,
        l10n.merchantStateRejectedTitle,
        l10n.merchantStateRejectedBody,
      ),
    };
    return Semantics(
      container: true,
      liveRegion: true,
      child: Container(
        key: ValueKey('verification-${state.name}'),
        padding: const EdgeInsets.all(AskidaSpacing.s4),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(AskidaRadius.card),
          border: Border.all(color: c.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ExcludeSemantics(child: Icon(icon, color: color)),
            const SizedBox(width: AskidaSpacing.s3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: theme.textTheme.titleSmall),
                  const SizedBox(height: AskidaSpacing.s1),
                  Text(
                    body,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: c.textMuted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
