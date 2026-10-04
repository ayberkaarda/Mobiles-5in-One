import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/recipient/presentation/widgets/station_rail.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

/// Onboarding screen 1 of 3: the station rail and one sentence. The mode
/// switcher above it (in the shell) is the other half of this screen;
/// nothing here asks for an account.
class OnboardingIntro extends StatelessWidget {
  const new({required this.onStart, super.key});

  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    return ListView(
      key: const ValueKey('recipient-intro'),
      padding: const EdgeInsets.all(AskidaLayout.screenGutter),
      children: [
        const SizedBox(height: AskidaSpacing.s4),
        const StationRail(),
        const SizedBox(height: AskidaSpacing.s8),
        Text(
          l10n.recipientIntroTitle,
          style: AskidaTypography.title1.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s3),
        Text(
          l10n.recipientIntroBody,
          style: AskidaTypography.bodyLarge.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s6),
        FilledButton(
          key: const ValueKey('recipient-intro-start'),
          onPressed: onStart,
          child: Text(l10n.recipientIntroStart),
        ),
        const SizedBox(height: AskidaSpacing.s4),
        Text(
          l10n.recipientIntroOtherModes,
          style: AskidaTypography.footnote.copyWith(color: c.textMuted),
        ),
      ],
    );
  }
}
