import 'package:askida/core/time/clock.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/design/empty_state.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/code_tag.dart';
import 'package:askida/design/widgets/rail_counter.dart';
import 'package:askida/features/discovery/presentation/coarse_location.dart';
import 'package:askida/features/discovery/presentation/shop_list_tile.dart';
import 'package:askida/features/discovery/presentation/shop_map_view.dart';
import 'package:askida/features/recipient/domain/code_timing.dart';
import 'package:askida/features/recipient/domain/recipient_paths.dart';
import 'package:askida/features/recipient/domain/search_area.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/features/recipient/presentation/widgets/impact_card.dart';
import 'package:askida/features/recipient/presentation/widgets/problem_view.dart';
import 'package:askida/features/recipient/presentation/widgets/reset_data_button.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Onboarding screen 3 of 3 and the recipient home from then on: shops with
/// something on the rail near the coarse point, as rails (list) or on the
/// map, with today's counters and "Verilerimi sıfırla".
class NearbyShopsView extends ConsumerStatefulWidget {
  const new({required this.point, super.key});

  /// Two-decimal point from the coarse location.
  final GeoPoint point;

  static const double mapHeight = 360;

  @override
  ConsumerState<NearbyShopsView> createState() => _NearbyShopsViewState();
}

class _NearbyShopsViewState extends ConsumerState<NearbyShopsView> {
  bool _showMap = false;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final radius = ref.watch(recipientRadiusProvider);
    final query = NearbyQuery(widget.point, radius);
    final nearby = ref.watch(recipientNearbyProvider(query));

    final children = <Widget>[
      const _ActiveCodeBanner(),
      const _AreaHeader(),
      const SizedBox(height: AskidaSpacing.s3),
      SegmentedButton<bool>(
        key: const ValueKey('recipient-view-switch'),
        showSelectedIcon: false,
        segments: [
          ButtonSegment(value: false, label: Text(l10n.recipientViewList)),
          ButtonSegment(value: true, label: Text(l10n.recipientViewMap)),
        ],
        selected: {_showMap},
        onSelectionChanged: (selection) =>
            setState(() => _showMap = selection.single),
      ),
      const SizedBox(height: AskidaSpacing.s4),
      ...switch (nearby) {
        AsyncData(:final value) => _content(context, value, radius),
        AsyncError(:final error) => [
          RecipientProblemView(
            error: error,
            onRetry: () => ref.invalidate(recipientNearbyProvider(query)),
          ),
        ],
        _ => const [RecipientLoading()],
      },
      const SizedBox(height: AskidaSpacing.s8),
      const ResetDataButton(),
    ];

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(recipientNearbyProvider(query));
        await ref
            .read(recipientNearbyProvider(query).future)
            .catchError((Object _) => const ShopPage(shops: [], radius: 0));
      },
      child: ListView(
        key: const ValueKey('recipient-nearby'),
        padding: const EdgeInsets.all(AskidaLayout.screenGutter),
        children: children,
      ),
    );
  }

  List<Widget> _content(BuildContext context, ShopPage page, int radius) {
    final l10n = context.l10n;
    final shops = page.shops;
    void open(ShopSummary shop) => context.go(RecipientPaths.shop(shop.slug));

    if (shops.isEmpty) {
      return [
        EmptyState(
          title: l10n.recipientEmptyTitle,
          body: l10n.recipientEmptyBody,
        ),
        if (radius < RecipientRadius.max)
          Center(
            child: FilledButton.tonal(
              key: const ValueKey('recipient-widen'),
              onPressed: () =>
                  ref.read(recipientRadiusProvider.notifier).widen(),
              child: Text(l10n.recipientWiden),
            ),
          ),
        const SizedBox(height: AskidaSpacing.s6),
        _Impact(shops: shops),
      ];
    }

    return [
      RailCounter(
        count: availableTotal(shops),
        lead: l10n.recipientNearbyLead,
        tail: l10n.recipientNearbyTail,
      ),
      const SizedBox(height: AskidaSpacing.s4),
      if (_showMap)
        SizedBox(
          height: NearbyShopsView.mapHeight,
          child: ClipRRect(
            borderRadius: const BorderRadius.all(
              Radius.circular(AskidaRadius.card),
            ),
            child: ShopMapView(
              center: widget.point,
              shops: shops,
              onShopTap: open,
            ),
          ),
        )
      else
        for (final shop in shops) ...[
          ShopListTile(shop: shop, onTap: () => open(shop)),
          const SizedBox(height: AskidaSpacing.s2),
        ],
      const SizedBox(height: AskidaSpacing.s4),
      Text(
        l10n.recipientRadiusNote((radius / 1000).round()),
        style: AskidaTypography.footnote.copyWith(
          color: AskidaColors.of(context).textMuted,
        ),
      ),
      if (radius < RecipientRadius.max)
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            key: const ValueKey('recipient-widen'),
            onPressed: () => ref.read(recipientRadiusProvider.notifier).widen(),
            child: Text(l10n.recipientWiden),
          ),
        ),
      const SizedBox(height: AskidaSpacing.s4),
      _Impact(shops: shops),
    ];
  }
}

/// The area chip and "Değiştir" (back to the location step).
class _AreaHeader extends ConsumerWidget {
  const new();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final location = ref.watch(coarseLocationProvider);
    final label = location.district?.label ?? l10n.recipientAreaApproximate;
    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: AskidaSpacing.s2,
      children: [
        Chip(
          key: const ValueKey('recipient-area'),
          label: Text(label),
          backgroundColor: c.secondary,
          side: BorderSide.none,
        ),
        TextButton(
          key: const ValueKey('recipient-change-area'),
          onPressed: () => ref.read(coarseLocationProvider.notifier).clear(),
          child: Text(
            l10n.recipientChangeArea,
            semanticsLabel: l10n.recipientChangeAreaLabel,
          ),
        ),
      ],
    );
  }
}

class _Impact extends ConsumerWidget {
  const new({required this.shops});

  final List<ShopSummary> shops;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final area = impactAreaFor(ref.watch(coarseLocationProvider), shops);
    final impact = ref.watch(recipientImpactProvider(area));
    // The counters are secondary: while loading or on failure they are
    // simply not shown.
    return switch (impact) {
      AsyncData(:final value) => RecipientImpactCard(summary: value),
      _ => const SizedBox.shrink(),
    };
  }
}

/// "Aktif kodun var": leads back to the code while it is valid.
class _ActiveCodeBanner extends ConsumerWidget {
  const new();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = ref.watch(activeCodeProvider);
    final now = ref.watch(clockProvider)();
    if (active == null || CodeTiming.isExpired(active.expiresAt, now)) {
      return const SizedBox.shrink();
    }
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final expires = active.expiresAt;
    return Padding(
      padding: const EdgeInsets.only(bottom: AskidaSpacing.s4),
      child: DecoratedBox(
        key: const ValueKey('recipient-active-code'),
        decoration: BoxDecoration(
          color: c.surfaceRaised,
          border: Border.all(color: c.borderStrong),
          borderRadius: const BorderRadius.all(
            Radius.circular(AskidaRadius.card),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(AskidaSpacing.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.recipientActiveCodeTitle,
                style: AskidaTypography.bodyStrong.copyWith(color: c.text),
              ),
              Text(
                l10n.codeValidUntil(
                  clockTime(expires),
                  turkishDativeSuffix(expires),
                ),
                style: AskidaTypography.footnote.copyWith(color: c.textMuted),
              ),
              const SizedBox(height: AskidaSpacing.s2),
              FilledButton(
                key: const ValueKey('recipient-active-code-open'),
                onPressed: () => context.go(RecipientPaths.code),
                child: Text(l10n.recipientActiveCodeOpen),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
