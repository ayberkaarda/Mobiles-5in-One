import 'package:askida/core/errors/problem_messages.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// A merchant screen inside the mode shell: a back control and a title on
/// top, then the body. The shell already draws the app bar and the mode
/// switcher, so screens do not add their own.
class MerchantPage extends StatelessWidget {
  const new({
    required this.title,
    required this.child,
    this.showBack = true,
    super.key,
  });

  final String title;
  final Widget child;
  final bool showBack;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(
            AskidaSpacing.s1,
            AskidaSpacing.s1,
            AskidaLayout.screenGutter,
            AskidaSpacing.s1,
          ),
          child: Row(
            children: [
              if (showBack)
                IconButton(
                  icon: const Icon(Icons.arrow_back),
                  tooltip: context.l10n.merchantBack,
                  onPressed: () => context.canPop()
                      ? context.pop()
                      : context.go(AppMode.merchant.path),
                )
              else
                const SizedBox(width: AskidaSpacing.s3),
              Expanded(
                child: Semantics(
                  header: true,
                  child: Text(title, style: theme.textTheme.titleMedium),
                ),
              ),
            ],
          ),
        ),
        Expanded(child: child),
      ],
    );
  }
}

/// Copy for a server problem with a retry button, centred.
class ProblemView extends StatelessWidget {
  const new({required this.error, this.onRetry, super.key});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final retry = onRetry;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AskidaSpacing.s6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              errorMessage(l10n, error),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyLarge
                  ?.copyWith(color: AskidaColors.of(context).dangerText),
            ),
            if (retry != null) ...[
              const SizedBox(height: AskidaSpacing.s4),
              FilledButton.tonal(
                onPressed: retry,
                child: Text(l10n.merchantRetry),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// User copy for anything a merchant call can throw. Server text is never
/// shown: problems map by code, everything else is the generic message.
String errorMessage(AppLocalizations l10n, Object error) =>
    error is ApiProblem ? error.message(l10n) : l10n.problemGeneric;

/// Copy for a form [issue] (null when the field is fine).
String? issueText(AppLocalizations l10n, FieldIssue? issue) => switch (issue) {
  null => null,
  FieldIssue.required => l10n.merchantFieldRequired,
  FieldIssue.tooShort => l10n.merchantFieldTooShort,
  FieldIssue.tooLong => l10n.merchantFieldTooLong,
  FieldIssue.invalid => l10n.merchantFieldInvalid,
  FieldIssue.outOfRange => l10n.merchantFieldOutOfRange,
};

/// A row of a merchant list: title, optional subtitle, chevron. Rows are
/// separated by hairlines (rails), not cards.
class MerchantRow extends StatelessWidget {
  const new({
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
    super.key,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final sub = subtitle;
    final lead = leading;
    final trail = trailing;
    return Semantics(
      button: onTap != null,
      child: InkWell(
        onTap: onTap,
        child: Container(
          constraints: const BoxConstraints(
            minHeight: AskidaLayout.rowMinHeight,
          ),
          decoration: BoxDecoration(
            border: Border(bottom: BorderSide(color: c.border)),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: AskidaLayout.screenGutter,
            vertical: AskidaSpacing.s3,
          ),
          child: Row(
            children: [
              if (lead != null) ...[
                lead,
                const SizedBox(width: AskidaSpacing.s3),
              ],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(title, style: theme.textTheme.titleSmall),
                    if (sub != null)
                      Text(
                        sub,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: c.textMuted,
                        ),
                      ),
                  ],
                ),
              ),
              if (trail != null) ...[
                const SizedBox(width: AskidaSpacing.s2),
                trail,
              ] else if (onTap != null)
                ExcludeSemantics(
                  child: Icon(Icons.chevron_right, color: c.textMuted),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A small quiet chip (`secondary` fill) for states such as "Pasif".
class QuietChip extends StatelessWidget {
  const new({required this.label, super.key});

  final String label;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AskidaSpacing.s2,
        vertical: AskidaSpacing.s1 / 2,
      ),
      decoration: BoxDecoration(
        color: c.secondary,
        borderRadius: BorderRadius.circular(AskidaRadius.chip),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelMedium
            ?.copyWith(color: c.onSecondary),
      ),
    );
  }
}
