import 'package:askida/core/attest/attestation_service.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/recipient/domain/recipient_paths.dart';
import 'package:askida/features/recipient/domain/return_location.dart';
import 'package:askida/features/recipient/presentation/widgets/problem_view.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Anonymous entry: before the first code the device gets an anonymous
/// identity (`AnonRepository.attest`: device attestation + `POST
/// anon/attest`). No account, name or phone number is asked for. When the
/// device cannot attest and the build has no fallback (prod flavor), a calm
/// blocking message explains it; browsing shops stays open.
class RecipientStartScreen extends ConsumerStatefulWidget {
  const new({this.from, super.key});

  /// Where to continue afterwards (validated by [safeReturnLocation]).
  final String? from;

  @override
  ConsumerState<RecipientStartScreen> createState() =>
      _RecipientStartScreenState();
}

class _RecipientStartScreenState extends ConsumerState<RecipientStartScreen> {
  bool _busy = false;
  bool _blocked = false;
  Object? _error;

  Future<void> _attest() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(anonRepositoryProvider).attest();
      if (mounted) context.go(safeReturnLocation(widget.from));
    } on AttestationUnavailable {
      if (mounted) setState(() => _blocked = true);
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final hasAnon = ref.watch(sessionProvider.select((s) => s.hasAnonToken));
    final error = _error;

    final List<Widget> children;
    if (_blocked) {
      children = [
        Semantics(
          liveRegion: true,
          child: Text(
            l10n.recipientAttestBlockedTitle,
            key: const ValueKey('recipient-attest-blocked'),
            style: AskidaTypography.title1.copyWith(color: c.text),
          ),
        ),
        const SizedBox(height: AskidaSpacing.s3),
        Text(
          l10n.recipientAttestBlockedBody,
          style: AskidaTypography.body.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s6),
        FilledButton.tonal(
          onPressed: () => context.go(RecipientPaths.home),
          child: Text(l10n.recipientBackToShops),
        ),
      ];
    } else {
      children = [
        Text(
          l10n.recipientAttestTitle,
          style: AskidaTypography.title1.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s3),
        Text(
          l10n.recipientAttestBody,
          style: AskidaTypography.body.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s6),
        if (hasAnon)
          FilledButton(
            onPressed: () => context.go(safeReturnLocation(widget.from)),
            child: Text(l10n.recipientAttestContinue),
          )
        else
          FilledButton(
            key: const ValueKey('recipient-attest'),
            onPressed: _busy ? null : _attest,
            child: Text(l10n.recipientAttestContinue),
          ),
        if (error != null) RecipientProblemView(error: error),
        const SizedBox(height: AskidaSpacing.s4),
        Text(
          l10n.recipientAttestNote,
          style: AskidaTypography.footnote.copyWith(color: c.textMuted),
        ),
      ];
    }

    return Scaffold(
      appBar: AppBar(primary: false, title: Text(l10n.modeRecipient)),
      body: ListView(
        key: const ValueKey('recipient-start'),
        padding: const EdgeInsets.all(AskidaLayout.screenGutter),
        children: children,
      ),
    );
  }
}
