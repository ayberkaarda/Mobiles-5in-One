import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/typography.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/design/widgets/sample_chip.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:askida/features/recipient/domain/recipient_paths.dart';
import 'package:askida/features/recipient/presentation/recipient_providers.dart';
import 'package:askida/features/recipient/presentation/widgets/problem_view.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Design category of an item category (same six values).
ShopCategory categoryOfItem(ItemCategory category) => switch (category) {
  ItemCategory.ekmek => ShopCategory.ekmek,
  ItemCategory.corba => ShopCategory.corba,
  ItemCategory.yemek => ShopCategory.yemek,
  ItemCategory.kirtasiye => ShopCategory.kirtasiye,
  ItemCategory.bebek => ShopCategory.bebek,
  ItemCategory.diger => ShopCategory.diger,
};

/// A shop as a recipient sees it: where it is and what is on its rail
/// (counts only, no prices), with "Askıdan al" on every item that has one.
class RecipientShopScreen extends ConsumerWidget {
  const new({required this.slug, super.key});

  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final details = ref.watch(recipientShopProvider(slug));
    return Scaffold(
      appBar: AppBar(
        primary: false,
        // The name is the first line of the body; the bar stays generic.
        title: Text(l10n.recipientShopTitle),
      ),
      body: switch (details) {
        AsyncData(value: PublicShopDetails(:final shop)) => _ShopBody(
          shop: shop,
        ),
        AsyncData(value: OwnerShopDetails()) => Padding(
          padding: const EdgeInsets.all(AskidaLayout.screenGutter),
          child: Text(l10n.recipientShopOwnView),
        ),
        AsyncError(:final error) => ListView(
          padding: const EdgeInsets.all(AskidaLayout.screenGutter),
          children: [
            RecipientProblemView(
              error: error,
              onRetry: () => ref.invalidate(recipientShopProvider(slug)),
            ),
          ],
        ),
        _ => const RecipientLoading(),
      },
    );
  }
}

class _ShopBody extends StatelessWidget {
  const new({required this.shop});

  final PublicShop shop;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final items = shop.items;
    return ListView(
      key: const ValueKey('recipient-shop'),
      padding: const EdgeInsets.all(AskidaLayout.screenGutter),
      children: [
        Text(shop.name, style: AskidaTypography.title1.copyWith(color: c.text)),
        if (shop.isSample) ...[
          const SizedBox(height: AskidaSpacing.s2),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: SampleChip(label: l10n.sampleLabel),
          ),
        ],
        const SizedBox(height: AskidaSpacing.s2),
        Text(
          '${shop.ilce}, ${shop.il}',
          style: AskidaTypography.footnote.copyWith(color: c.textMuted),
        ),
        Text(
          shop.address,
          style: AskidaTypography.body.copyWith(color: c.text),
        ),
        const SizedBox(height: AskidaSpacing.s1),
        Row(
          children: [
            Icon(Icons.check, size: 16, color: c.success),
            const SizedBox(width: AskidaSpacing.s1),
            Flexible(
              child: Text(
                l10n.shopVerified,
                style: AskidaTypography.footnote.copyWith(color: c.success),
              ),
            ),
          ],
        ),
        const SizedBox(height: AskidaSpacing.s6),
        Semantics(
          header: true,
          child: Text(
            l10n.recipientShopItemsTitle,
            style: AskidaTypography.title3.copyWith(color: c.text),
          ),
        ),
        const SizedBox(height: AskidaSpacing.s3),
        Container(height: AskidaStroke.rail, color: c.text),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AskidaSpacing.s4),
            child: Text(
              l10n.shopNoneAvailable,
              style: AskidaTypography.body.copyWith(color: c.textMuted),
            ),
          )
        else
          for (final item in items)
            _ItemRow(
              item: item,
              onTake: item.availableCount > 0
                  ? () => context.go(RecipientPaths.reserve(shop.slug, item.id))
                  : null,
            ),
        const SizedBox(height: AskidaSpacing.s4),
        Text(
          l10n.recipientShopLimits,
          style: AskidaTypography.footnote.copyWith(color: c.textMuted),
        ),
      ],
    );
  }
}

/// One item on the shop's rail.
class _ItemRow extends StatelessWidget {
  const new({required this.item, this.onTake});

  final PublicItem item;
  final VoidCallback? onTake;

  @override
  Widget build(BuildContext context) {
    final c = AskidaColors.of(context);
    final l10n = context.l10n;
    final count = item.availableCount < 0 ? 0 : item.availableCount;
    final hasItems = count > 0;
    final category = categoryOfItem(item.category);
    return Container(
      key: ValueKey('recipient-item-${item.id}'),
      constraints: const BoxConstraints(minHeight: 72),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: c.border)),
      ),
      padding: const EdgeInsets.symmetric(vertical: AskidaSpacing.s3),
      child: Wrap(
        crossAxisAlignment: WrapCrossAlignment.center,
        alignment: WrapAlignment.spaceBetween,
        spacing: AskidaSpacing.s3,
        runSpacing: AskidaSpacing.s2,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              AskidaTag(
                width: 32,
                height: 40,
                tone: hasItems ? AskidaTagTone.accent : AskidaTagTone.secondary,
                semanticLabel: category.label(l10n),
                child: Icon(category.icon, size: 16),
              ),
              const SizedBox(width: AskidaSpacing.s3),
              Flexible(
                child: Semantics(
                  label: hasItems
                      ? l10n.recipientItemCountLabel(item.name, count)
                      : '${item.name}, ${l10n.shopNoneAvailable}',
                  excludeSemantics: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        item.name,
                        style: AskidaTypography.bodyStrong.copyWith(
                          color: c.text,
                        ),
                      ),
                      Text(
                        hasItems
                            ? l10n.recipientItemCount(count)
                            : l10n.shopNoneAvailable,
                        style: AskidaTypography.footnote.copyWith(
                          color: c.textMuted,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          if (onTake != null)
            FilledButton.tonal(
              key: ValueKey('recipient-take-${item.id}'),
              onPressed: onTake,
              child: Text(
                l10n.recipientTake,
                semanticsLabel: l10n.recipientTakeLabel(item.name),
              ),
            ),
        ],
      ),
    );
  }
}
