import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// "Verilerimi sıfırla" with its explanation and a confirmation dialog.
class ResetDataButton extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<ResetDataButton> createState() => _ResetDataButtonState();
}

class _ResetDataButtonState extends ConsumerState<ResetDataButton> {
  bool _busy = false;

  Future<void> _confirmAndReset() async {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.recipientResetTitle),
        content: Text(l10n.recipientResetBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.recipientResetCancel),
          ),
          FilledButton(
            key: const ValueKey('recipient-reset-confirm'),
            style: FilledButton.styleFrom(
              backgroundColor: c.danger,
              foregroundColor: c.onDanger,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.recipientResetConfirm),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.maybeOf(context);
    final confirmedByServer = await ref.read(recipientResetProvider).run();
    if (!mounted) return;
    setState(() => _busy = false);
    messenger?.showSnackBar(
      SnackBar(
        content: Text(
          confirmedByServer
              ? l10n.recipientResetDone
              : l10n.recipientResetDoneOffline,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        TextButton(
          key: const ValueKey('recipient-reset'),
          onPressed: _busy ? null : _confirmAndReset,
          child: Text(l10n.recipientResetAction),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AskidaSpacing.s3),
          child: Text(
            l10n.recipientResetHint,
            style: AskidaTypography.footnote.copyWith(color: c.textMuted),
          ),
        ),
      ],
    );
  }
}
