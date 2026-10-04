import 'package:askida/data/session.dart';
import 'package:askida/design/empty_state.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:askida/features/merchant/merchant_paths.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/features/merchant/presentation/widgets/verification_banner.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Merchant mode home. Without a merchant account it explains what the
/// mode needs; with one it offers to register or link a shop, and once a
/// shop is known it is the merchant's dashboard.
class MerchantHomeScreen extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    // A bare router without the app's provider scope (route registry
    // checks) gets the signed-out view instead of a missing-scope error.
    final scoped =
        context.findAncestorWidgetOfExactType<UncontrolledProviderScope>() !=
        null;
    return scoped
        ? const _MerchantHome()
        : const _SignedOutView(session: SessionState());
  }
}

class _MerchantHome extends ConsumerWidget {
  const new();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    if (!session.isMerchant) return _SignedOutView(session: session);
    final shop = ref.watch(merchantShopProvider);
    return switch (shop) {
      AsyncData(value: final MerchantShop shop) => MerchantDashboard(
        shop: shop,
      ),
      AsyncData() => const _NoShopView(),
      AsyncError(:final error) => ProblemView(
        error: error,
        onRetry: () => ref.read(merchantShopProvider.notifier).reload(),
      ),
      _ => const Center(child: CircularProgressIndicator()),
    };
  }
}

class _SignedOutView extends StatelessWidget {
  const new({required this.session});

  final SessionState session;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final otherAccount = session.isSignedIn;
    return _CenteredActions(
      title: l10n.merchantEmptyTitle,
      body: otherAccount
          ? l10n.merchantWrongAccountBody
          : l10n.merchantSignedOutBody,
      actions: [
        if (!otherAccount)
          FilledButton(
            onPressed: () => context.go(
              Uri(
                path: AppPaths.auth,
                queryParameters: {'from': MerchantPaths.home},
              ).toString(),
            ),
            child: Text(l10n.merchantSignIn),
          ),
      ],
    );
  }
}

class _NoShopView extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return _CenteredActions(
      title: l10n.merchantNoShopTitle,
      body: l10n.merchantNoShopBody,
      actions: [
        FilledButton(
          onPressed: () => context.push(MerchantPaths.register),
          child: Text(l10n.merchantRegisterShop),
        ),
        FilledButton.tonal(
          onPressed: () => context.push(MerchantPaths.link),
          child: Text(l10n.merchantLinkShop),
        ),
      ],
    );
  }
}

class _CenteredActions extends StatelessWidget {
  const new({required this.title, required this.body, required this.actions});

  final String title;
  final String body;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AskidaSpacing.s6),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Center(child: EmptyRail()),
            const SizedBox(height: AskidaSpacing.s6),
            Text(
              title,
              style: theme.textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AskidaSpacing.s3),
            Text(
              body,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: AskidaColors.of(context).textMuted,
              ),
              textAlign: TextAlign.center,
            ),
            for (final action in actions) ...[
              const SizedBox(height: AskidaSpacing.s3),
              action,
            ],
          ],
        ),
      ),
    );
  }
}

/// The dashboard of a known shop.
class MerchantDashboard extends ConsumerWidget {
  const new({required this.shop, super.key});

  final MerchantShop shop;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final verification = shop.verification;
    return RefreshIndicator(
      onRefresh: () => ref.read(merchantShopProvider.notifier).reload(),
      child: ListView(
        padding: const EdgeInsets.only(bottom: AskidaSpacing.s8),
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AskidaLayout.screenGutter,
              AskidaSpacing.s2,
              AskidaLayout.screenGutter,
              AskidaSpacing.s4,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(shop.name, style: theme.textTheme.titleLarge),
                ),
                const SizedBox(height: AskidaSpacing.s2),
                QuietChip(
                  label: shop.isOwner
                      ? l10n.merchantRoleOwner
                      : l10n.merchantRoleStaff,
                ),
                if (shop.offline) ...[
                  const SizedBox(height: AskidaSpacing.s3),
                  Text(
                    l10n.merchantOfflineNote,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: c.textMuted,
                    ),
                  ),
                ],
                if (verification != null) ...[
                  const SizedBox(height: AskidaSpacing.s4),
                  VerificationBanner(state: verification),
                ],
                const SizedBox(height: AskidaSpacing.s4),
                FilledButton.icon(
                  key: const ValueKey('merchant-redeem'),
                  onPressed: () => context.push(MerchantPaths.redeem),
                  icon: const Icon(Icons.qr_code_scanner),
                  label: Text(l10n.merchantRedeemAction),
                ),
              ],
            ),
          ),
          MerchantRow(
            title: l10n.merchantRedemptionsTitle,
            subtitle: l10n.merchantRedemptionsSubtitle,
            onTap: () => context.push(MerchantPaths.redemptions),
          ),
          MerchantRow(
            title: l10n.merchantCatalogTitle,
            subtitle: shop.isOwner
                ? l10n.merchantCatalogSubtitleOwner
                : l10n.merchantCatalogSubtitleStaff,
            onTap: () => context.push(MerchantPaths.catalog),
          ),
          if (shop.isOwner) ...[
            MerchantRow(
              title: l10n.merchantPayoutsTitle,
              subtitle: l10n.merchantPayoutsSubtitle,
              onTap: () => context.push(MerchantPaths.payouts),
            ),
            MerchantRow(
              title: l10n.merchantDocumentsTitle,
              subtitle: l10n.merchantDocumentsSubtitle,
              onTap: () => context.push(MerchantPaths.documents),
            ),
            MerchantRow(
              title: l10n.merchantProfileTitle,
              subtitle: l10n.merchantProfileSubtitle,
              onTap: () => context.push(MerchantPaths.profile),
            ),
          ] else
            Padding(
              padding: const EdgeInsets.all(AskidaLayout.screenGutter),
              child: Text(
                l10n.merchantStaffNote,
                style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
              ),
            ),
        ],
      ),
    );
  }
}
