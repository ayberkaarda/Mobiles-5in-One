import 'package:askida/core/errors/problem_messages.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

/// Full-screen form layout of the auth and settings screens: an app bar
/// with a back button and one scrolling column with the screen gutter, so
/// 1.3 text and a 320 px width never overflow.
class FormScreen extends StatelessWidget {
  const new({
    required this.title,
    required this.children,
    this.onBack,
    super.key,
  });

  final String title;
  final List<Widget> children;

  /// Back action when the screen was opened with `go` (no stack to pop).
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    final back = onBack;
    return Scaffold(
      appBar: AppBar(
        title: Text(title),
        leading: back == null ? null : BackButton(onPressed: back),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AskidaLayout.screenGutter,
            AskidaSpacing.s4,
            AskidaLayout.screenGutter,
            AskidaSpacing.s8,
          ),
          children: children,
        ),
      ),
    );
  }
}

/// The user copy of a failed call, announced to screen readers. Server
/// text is never shown, only the ARB copy of the problem code.
class ProblemBanner extends StatelessWidget {
  const new({required this.problem, super.key});

  final ApiProblem problem;

  @override
  Widget build(BuildContext context) =>
      MessageBanner(message: problem.message(context.l10n), error: true);
}

/// A short message box: errors in the danger text colour, notes muted.
class MessageBanner extends StatelessWidget {
  const new({required this.message, this.error = false, super.key});

  final String message;
  final bool error;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final theme = Theme.of(context);
    return Semantics(
      liveRegion: true,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AskidaSpacing.s3),
        decoration: BoxDecoration(
          color: c.surface,
          borderRadius: BorderRadius.circular(AskidaRadius.input),
          border: Border.all(color: error ? c.danger : c.border),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              error ? Icons.error_outline : Icons.info_outline,
              color: error ? c.dangerText : c.info,
              size: 20,
            ),
            const SizedBox(width: AskidaSpacing.s2),
            Expanded(
              child: Text(
                message,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: error ? c.dangerText : c.text,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Primary action with a busy state: while [busy] the button is disabled
/// and shows a small progress indicator next to the label.
class BusyButton extends StatelessWidget {
  const new({
    required this.label,
    required this.onPressed,
    this.busy = false,
    this.tonal = false,
    this.danger = false,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  final bool tonal;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final child = Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (busy) ...[
          const SizedBox.square(
            dimension: 16,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: AskidaSpacing.s2),
        ],
        Flexible(child: Text(label, textAlign: TextAlign.center)),
      ],
    );
    final action = busy ? null : onPressed;
    final style = danger
        ? FilledButton.styleFrom(
            backgroundColor: c.danger,
            foregroundColor: c.onDanger,
          )
        : null;
    return SizedBox(
      width: double.infinity,
      child: tonal
          ? FilledButton.tonal(onPressed: action, child: child)
          : FilledButton(onPressed: action, style: style, child: child),
    );
  }
}

const SizedBox formGap = SizedBox(height: AskidaSpacing.s4);
const SizedBox formGapSmall = SizedBox(height: AskidaSpacing.s2);
