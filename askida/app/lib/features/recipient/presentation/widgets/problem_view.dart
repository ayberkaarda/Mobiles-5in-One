import 'package:askida/core/errors/problem_messages.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

/// User copy for any error a recipient screen can meet: the mapped problem
/// text, never the server's own words.
String recipientErrorText(BuildContext context, Object error) {
  final l10n = context.l10n;
  return error is ApiProblem ? error.message(l10n) : l10n.problemGeneric;
}

/// A calm error line with an optional retry button.
class RecipientProblemView extends StatelessWidget {
  const new({required this.error, this.onRetry, super.key});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final retry = onRetry;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AskidaSpacing.s6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Semantics(
            liveRegion: true,
            child: Text(
              recipientErrorText(context, error),
              key: const ValueKey('recipient-problem'),
              style: AskidaTypography.body.copyWith(color: c.dangerText),
              textAlign: TextAlign.center,
            ),
          ),
          if (retry != null) ...[
            const SizedBox(height: AskidaSpacing.s3),
            FilledButton.tonal(
              onPressed: retry,
              child: Text(context.l10n.recipientRetry),
            ),
          ],
        ],
      ),
    );
  }
}

/// Centered progress indicator with a spoken label.
class RecipientLoading extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(AskidaSpacing.s8),
    child: Center(
      child: Semantics(
        label: context.l10n.recipientLoading,
        child: const CircularProgressIndicator(),
      ),
    ),
  );
}
