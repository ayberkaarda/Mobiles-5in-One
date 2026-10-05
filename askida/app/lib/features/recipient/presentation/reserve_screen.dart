import 'package:askida/core/time/clock.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/features/recipient/domain/code_timing.dart';
import 'package:askida/features/recipient/domain/recipient_paths.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/features/recipient/presentation/widgets/problem_view.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Confirms one item before the code is issued (`POST hooks/reserve` with
/// the anonymous token; the guard sends devices without one to the
/// anonymous entry first). While a code is still valid no second one is
/// asked for.
class ReserveScreen extends ConsumerStatefulWidget {
  const new({required this.slug, required this.itemId, super.key});

  final String slug;
  final String itemId;

  @override
  ConsumerState<ReserveScreen> createState() => _ReserveScreenState();
}

class _ReserveScreenState extends ConsumerState<ReserveScreen> {
  bool _busy = false;
  Object? _error;

  Future<void> _reserve(PublicShop shop, PublicItem item) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final reservation = await ref
          .read(hooksRepositoryProvider)
          .reserve(shop.id, item.id);
      ref
          .read(activeCodeProvider.notifier)
          .hold(reservation, shopSlug: shop.slug);
      if (mounted) context.go(RecipientPaths.code);
    } on Exception catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final details = ref.watch(recipientShopProvider(widget.slug));
    return Scaffold(
      appBar: AppBar(primary: false, title: Text(l10n.recipientReserveTitle)),
      body: switch (details) {
        AsyncData(value: PublicShopDetails(:final shop)) => _body(shop),
        AsyncData() => _missing(),
        AsyncError(:final error) => ListView(
          padding: const EdgeInsets.all(AskidaLayout.screenGutter),
          children: [
            RecipientProblemView(
              error: error,
              onRetry: () => ref.invalidate(recipientShopProvider(widget.slug)),
            ),
          ],
        ),
        _ => const RecipientLoading(),
      },
    );
  }

  Widget _missing() => ListView(
    padding: const EdgeInsets.all(AskidaLayout.screenGutter),
    children: [
      Text(context.l10n.problemHookNoneAvailable),
      const SizedBox(height: AskidaSpacing.s4),
      FilledButton.tonal(
        onPressed: () => context.go(RecipientPaths.home),
        child: Text(context.l10n.recipientBackToShops),
      ),
    ],
  );

  Widget _body(PublicShop shop) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final item = shop.items.where((i) => i.id == widget.itemId).firstOrNull;
    if (item == null) return _missing();

    final active = ref.watch(activeCodeProvider);
    final now = ref.watch(clockProvider)();
    final holding =
        active != null && !CodeTiming.isExpired(active.expiresAt, now);
    final error = _error;

    return ListView(
      key: const ValueKey('recipient-reserve'),
      padding: const EdgeInsets.all(AskidaLayout.screenGutter),
      children: [
        Text(
          l10n.recipientReserveItem(item.name),
          style: AskidaTypography.title1.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s1),
        Text(shop.name, style: AskidaTypography.title3.copyWith(color: c.text)),
        const SizedBox(height: AskidaSpacing.s4),
        Text(
          l10n.recipientReserveBody(CodeTiming.window.inMinutes),
          style: AskidaTypography.body.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s6),
        if (holding) ...[
          Text(
            l10n.recipientReserveHolding,
            key: const ValueKey('recipient-reserve-holding'),
            style: AskidaTypography.body.copyWith(color: c.textMuted),
          ),
          const SizedBox(height: AskidaSpacing.s3),
          FilledButton(
            onPressed: () => context.go(RecipientPaths.code),
            child: Text(l10n.recipientActiveCodeOpen),
          ),
        ] else
          FilledButton(
            key: const ValueKey('recipient-reserve-confirm'),
            onPressed: _busy ? null : () => _reserve(shop, item),
            child: Text(l10n.recipientReserveConfirm),
          ),
        if (error != null) RecipientProblemView(error: error),
        const SizedBox(height: AskidaSpacing.s4),
        Text(
          l10n.recipientShopLimits,
          style: AskidaTypography.footnote.copyWith(color: c.textMuted),
        ),
      ],
    );
  }
}
