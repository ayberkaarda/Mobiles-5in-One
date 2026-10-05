import 'dart:async';

import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/empty_state.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/features/discovery/domain/districts.dart';
import 'package:askida/features/discovery/presentation/shop_list_tile.dart';
import 'package:askida/features/discovery/presentation/shop_map_view.dart';
import 'package:askida/features/donor/presentation/donor_providers.dart';
import 'package:askida/features/impact/presentation/impact_section.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Home of the donor mode ("Askıya bırak"): the donor's impact card (or,
/// signed out, what the mode is for), then verified shops near the donor as
/// a rail list or on the map. Browsing needs no account; paying does (the
/// guard sends the donor to sign-in at that point).
class DonorHomeScreen extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    // The app always runs under a ProviderScope. Bare router harnesses
    // (route tests that build the shell alone) do not; they get the static
    // introduction instead of a crash.
    if (!_hasProviderScope(context)) {
      final l10n = context.l10n;
      return EmptyState(title: l10n.donorEmptyTitle, body: l10n.donorEmptyBody);
    }
    return const _DonorHome();
  }
}

bool _hasProviderScope(BuildContext context) {
  try {
    ProviderScope.containerOf(context, listen: false);
    return true;
  } on Object {
    return false;
  }
}

class _DonorHome extends ConsumerStatefulWidget {
  const new();

  @override
  ConsumerState<_DonorHome> createState() => _DonorHomeState();
}

enum _ShopView { list, map }

class _DonorHomeState extends ConsumerState<_DonorHome> {
  _ShopView _view = _ShopView.list;

  void _openShop(ShopSummary shop) =>
      context.go(AppPaths.shop(AppMode.donor, shop.slug));

  Future<void> _pickDistrict() async {
    final district = await showModalBottomSheet<District>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => const DistrictPickerSheet(),
    );
    if (district != null) {
      ref.read(donorLocationProvider.notifier).chooseDistrict(district);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final session = ref.watch(sessionProvider);
    final location = ref.watch(donorLocationProvider);
    final point = location.point;
    return ListView(
      key: const ValueKey('donor-home'),
      padding: const EdgeInsets.fromLTRB(
        AskidaLayout.screenGutter,
        AskidaSpacing.s2,
        AskidaLayout.screenGutter,
        AskidaSpacing.s8,
      ),
      children: [
        if (session.isDonor) ...[
          const ImpactSection(),
          formGapSmall,
          _LinkRow(
            links: [
              (
                const ValueKey('donor-history-link'),
                l10n.donorHistoryLink,
                () => context.go(AppPaths.donorDonations),
              ),
              (
                const ValueKey('donor-settings-link'),
                l10n.settingsTitle,
                () => context.push(AppPaths.settings),
              ),
            ],
          ),
        ] else
          _SignedOutIntro(signedInOtherKind: session.isSignedIn),
        formGap,
        if (point == null)
          _LocationPrompt(
            state: location,
            onUseLocation: () => unawaited(
              ref.read(donorLocationProvider.notifier).requestAndLocate(),
            ),
            onPickDistrict: () => unawaited(_pickDistrict()),
          )
        else ...[
          _ShopsHeader(
            area: location.district?.label ?? l10n.donorNearYou,
            view: _view,
            onViewChanged: (view) => setState(() => _view = view),
            onChangeArea: () => unawaited(_pickDistrict()),
          ),
          formGapSmall,
          _ShopsBody(point: point, view: _view, onShopTap: _openShop),
        ],
      ],
    );
  }
}

class _LinkRow extends StatelessWidget {
  const new({required this.links});

  final List<(Key, String, VoidCallback)> links;

  @override
  Widget build(BuildContext context) => Wrap(
    spacing: AskidaSpacing.s2,
    children: [
      for (final (key, label, onTap) in links)
        TextButton(key: key, onPressed: onTap, child: Text(label)),
    ],
  );
}

class _SignedOutIntro extends StatelessWidget {
  const new({required this.signedInOtherKind});

  /// A merchant account is signed in: donating needs a donor account.
  final bool signedInOtherKind;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.donorEmptyTitle, style: theme.textTheme.headlineSmall),
        formGapSmall,
        Text(
          signedInOtherKind ? l10n.donorNeedsDonorAccount : l10n.donorEmptyBody,
          style: theme.textTheme.bodyLarge?.copyWith(color: c.textMuted),
        ),
        formGap,
        Wrap(
          spacing: AskidaSpacing.s2,
          runSpacing: AskidaSpacing.s2,
          children: [
            if (!signedInOtherKind)
              FilledButton.tonal(
                key: const ValueKey('donor-signin'),
                onPressed: () =>
                    context.push(AuthPaths.signIn(from: AppMode.donor.path)),
                child: Text(l10n.authSignInAction),
              ),
            TextButton(
              key: const ValueKey('donor-settings-link'),
              onPressed: () => context.push(AppPaths.settings),
              child: Text(l10n.settingsTitle),
            ),
          ],
        ),
      ],
    );
  }
}

/// Before a centre exists: why the location helps, "Konumu kullan" and the
/// district picker as the equal alternative.
class _LocationPrompt extends StatelessWidget {
  const new({
    required this.state,
    required this.onUseLocation,
    required this.onPickDistrict,
  });

  final DonorLocationState state;
  final VoidCallback onUseLocation;
  final VoidCallback onPickDistrict;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return Container(
      key: const ValueKey('donor-location-prompt'),
      padding: const EdgeInsets.all(AskidaSpacing.s4),
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(AskidaRadius.card),
        border: Border.all(color: c.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l10n.donorLocationTitle, style: theme.textTheme.titleMedium),
          formGapSmall,
          Text(
            state.offerDistrictsOnly
                ? l10n.donorLocationUnavailable
                : l10n.donorLocationRationale,
            style: theme.textTheme.bodyMedium,
          ),
          formGap,
          if (!state.offerDistrictsOnly) ...[
            BusyButton(
              key: const ValueKey('donor-use-location'),
              label: l10n.donorUseLocation,
              onPressed: onUseLocation,
            ),
            formGapSmall,
          ],
          BusyButton(
            key: const ValueKey('donor-pick-district'),
            label: l10n.donorPickDistrict,
            tonal: true,
            onPressed: onPickDistrict,
          ),
        ],
      ),
    );
  }
}

class _ShopsHeader extends StatelessWidget {
  const new({
    required this.area,
    required this.view,
    required this.onViewChanged,
    required this.onChangeArea,
  });

  final String area;
  final _ShopView view;
  final ValueChanged<_ShopView> onViewChanged;
  final VoidCallback onChangeArea;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l10n.donorShopsTitle, style: theme.textTheme.titleLarge),
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: AskidaSpacing.s2,
          children: [
            Text(area, style: theme.textTheme.bodyMedium),
            TextButton(
              key: const ValueKey('donor-change-area'),
              onPressed: onChangeArea,
              child: Text(l10n.donorChangeArea),
            ),
          ],
        ),
        formGapSmall,
        SegmentedButton<_ShopView>(
          key: const ValueKey('donor-view-toggle'),
          showSelectedIcon: false,
          segments: [
            ButtonSegment(
              value: _ShopView.list,
              label: Text(l10n.donorViewList),
              icon: const Icon(Icons.view_list_outlined),
            ),
            ButtonSegment(
              value: _ShopView.map,
              label: Text(l10n.donorViewMap),
              icon: const Icon(Icons.map_outlined),
            ),
          ],
          selected: {view},
          onSelectionChanged: (selection) => onViewChanged(selection.first),
        ),
      ],
    );
  }
}

class _ShopsBody extends ConsumerWidget {
  const new({required this.point, required this.view, required this.onShopTap});

  final GeoPoint point;
  final _ShopView view;
  final ValueChanged<ShopSummary> onShopTap;

  static const double mapHeight = 360;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final shops = ref.watch(donorNearbyShopsProvider(point));
    return shops.when(
      skipLoadingOnReload: true,
      data: (page) {
        if (page.shops.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: AskidaSpacing.s6),
            child: Text(
              l10n.donorNoShops,
              key: const ValueKey('donor-no-shops'),
              style: Theme.of(context).textTheme.bodyLarge,
            ),
          );
        }
        if (view == _ShopView.map) {
          return ClipRRect(
            borderRadius: BorderRadius.circular(AskidaRadius.card),
            child: SizedBox(
              height: mapHeight,
              child: ShopMapView(
                center: point,
                shops: page.shops,
                onShopTap: onShopTap,
              ),
            ),
          );
        }
        return Column(
          children: [
            for (final shop in page.shops) ...[
              ShopListTile(shop: shop, onTap: () => onShopTap(shop)),
              formGapSmall,
            ],
          ],
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.all(AskidaSpacing.s6),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (error, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (error is ApiProblem)
            ProblemBanner(problem: error)
          else
            MessageBanner(message: l10n.problemGeneric, error: true),
          formGapSmall,
          TextButton(
            key: const ValueKey('donor-shops-retry'),
            onPressed: () => ref.invalidate(donorNearbyShopsProvider(point)),
            child: Text(l10n.donorRetry),
          ),
        ],
      ),
    );
  }
}

/// The district list (bottom sheet) for donors who do not share their
/// location.
class DistrictPickerSheet extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.75,
        ),
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AskidaLayout.screenGutter,
              ),
              child: Text(
                l10n.donorPickDistrict,
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
            for (final district in kPickerDistricts)
              ListTile(
                key: ValueKey('district-${district.ilce}'),
                title: Text(district.label),
                onTap: () => Navigator.of(context).pop(district),
              ),
          ],
        ),
      ),
    );
  }
}
