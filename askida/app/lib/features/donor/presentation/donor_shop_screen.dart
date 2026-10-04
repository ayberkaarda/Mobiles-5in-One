import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/money.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/design/widgets/sample_chip.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/features/donor/presentation/donor_paths.dart';
import 'package:askida/features/donor/presentation/donor_providers.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Glyph category of an item.
ShopCategory categoryForItem(ItemCategory category) => switch (category) {
  ItemCategory.ekmek => ShopCategory.ekmek,
  ItemCategory.corba => ShopCategory.corba,
  ItemCategory.yemek => ShopCategory.yemek,
  ItemCategory.kirtasiye => ShopCategory.kirtasiye,
  ItemCategory.bebek => ShopCategory.bebek,
  ItemCategory.diger => ShopCategory.diger,
};

/// `/donor/shop/:slug`: a verified shop's rail. Each item row shows the
/// price and how many are on the rail; tapping one starts a donation.
class DonorShopScreen extends ConsumerWidget {
  const new({required this.slug, super.key});

  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final shop = ref.watch(donorShopProvider(slug));
    return Scaffold(
      appBar: AppBar(
        leading: BackButton(
          onPressed: () =>
              context.canPop() ? context.pop() : context.go(AppMode.donor.path),
        ),
        title: Text(
          shop.value?.name ?? l10n.donorShopTitle,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: shop.when(
        data: (details) => switch (details) {
          PublicShopDetails(:final shop) => _ShopRail(shop: shop),
          OwnerShopDetails() => Padding(
            padding: const EdgeInsets.all(AskidaLayout.screenGutter),
            child: MessageBanner(message: l10n.donorOwnShop),
          ),
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Padding(
          padding: const EdgeInsets.all(AskidaLayout.screenGutter),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (error is ApiProblem)
                ProblemBanner(problem: error)
              else
                MessageBanner(message: l10n.problemGeneric, error: true),
              formGapSmall,
              TextButton(
                onPressed: () => ref.invalidate(donorShopProvider(slug)),
                child: Text(l10n.donorRetry),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ShopRail extends StatelessWidget {
  const new({required this.shop});

  final PublicShop shop;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AskidaLayout.screenGutter,
        AskidaSpacing.s4,
        AskidaLayout.screenGutter,
        AskidaSpacing.s8,
      ),
      children: [
        Text(shop.name, style: theme.textTheme.headlineSmall),
        formGapSmall,
        Wrap(
          spacing: AskidaSpacing.s2,
          runSpacing: AskidaSpacing.s1,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(
              '${shop.typeLabel ?? ''}${shop.typeLabel == null ? '' : ' · '}'
              '${shop.ilce}, ${shop.il}',
              style: theme.textTheme.bodyMedium?.copyWith(color: c.textMuted),
            ),
            if (shop.isSample) SampleChip(label: l10n.sampleLabel),
          ],
        ),
        Text(
          shop.address,
          style: theme.textTheme.bodyMedium?.copyWith(color: c.textMuted),
        ),
        const SizedBox(height: AskidaSpacing.s6),
        Text(l10n.donorShopItemsTitle, style: theme.textTheme.titleMedium),
        formGapSmall,
        if (shop.items.isEmpty)
          Text(l10n.donorShopNoItems, style: theme.textTheme.bodyLarge)
        else
          for (final item in shop.items) ...[
            DonorItemRow(
              item: item,
              onTap: () => context.go(
                DonorPaths.donate(shopSlug: shop.slug, itemId: item.id),
              ),
            ),
            formGapSmall,
          ],
        formGap,
        Text(
          l10n.donorShopFootnote,
          style: AskidaTypography.footnote.copyWith(color: c.textMuted),
        ),
      ],
    );
  }
}

/// One item on a shop's rail: the category tag, name, price and today's
/// count on the rail.
class DonorItemRow extends StatelessWidget {
  const new({required this.item, required this.onTap, super.key});

  final PublicItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final theme = Theme.of(context);
    final price = Money(item.priceMinor).format(l10n.localeName);
    final category = categoryForItem(item.category);
    return Semantics(
      button: true,
      label: l10n.donorItemLabel(item.name, price, item.availableCount),
      excludeSemantics: true,
      child: Material(
        key: ValueKey('item-${item.id}'),
        color: c.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AskidaRadius.row),
          side: BorderSide(color: c.border),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(AskidaRadius.row),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 72),
            child: Padding(
              padding: const EdgeInsets.all(AskidaSpacing.s4),
              child: Row(
                children: [
                  AskidaTag(
                    width: 40,
                    height: 40,
                    tone: item.availableCount > 0
                        ? AskidaTagTone.accent
                        : AskidaTagTone.secondary,
                    child: Icon(
                      category.icon,
                      size: 20,
                      color: item.availableCount > 0 ? c.onAccent : c.text,
                    ),
                  ),
                  const SizedBox(width: AskidaSpacing.s3),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name, style: theme.textTheme.titleMedium),
                        Text(
                          price,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontFeatures: Money.tabularFigures,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AskidaSpacing.s2),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        item.availableCount > 0
                            ? '${item.availableCount}'
                            : '—',
                        style: AskidaTypography.numeral.copyWith(color: c.text),
                      ),
                      Text(
                        l10n.shopAvailableCaption,
                        style: AskidaTypography.caption.copyWith(
                          color: c.textMuted,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
