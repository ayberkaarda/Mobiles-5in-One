import 'package:askida/data/models/item.dart';
import 'package:askida/data/models/money.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/design/widgets/askida_tag.dart';
import 'package:askida/design/widgets/shop_card.dart';
import 'package:askida/features/merchant/domain/merchant_shop.dart';
import 'package:askida/features/merchant/merchant_paths.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_providers.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Local copy for a category (server labels are not shown).
String categoryLabel(AppLocalizations l10n, ItemCategory category) =>
    ShopCategory.values.byName(category.name).label(l10n);

IconData categoryIcon(ItemCategory category) =>
    ShopCategory.values.byName(category.name).icon;

/// The shop's items. Owners add, edit and switch items on or off; staff
/// see the list only.
class CatalogScreen extends ConsumerWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final isOwner =
        ref.watch(merchantShopProvider).value?.role == MerchantRole.owner;
    final catalog = ref.watch(catalogProvider);
    return MerchantPage(
      title: l10n.merchantCatalogTitle,
      child: switch (catalog) {
        AsyncData(:final value) => _CatalogList(
          items: value,
          editable: isOwner,
        ),
        AsyncError(:final error) => ProblemView(
          error: error,
          onRetry: () => ref.invalidate(catalogProvider),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _CatalogList extends ConsumerWidget {
  const new({required this.items, required this.editable});

  final List<Item> items;
  final bool editable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return ListView(
      padding: const EdgeInsets.only(bottom: AskidaSpacing.s8),
      children: [
        if (editable)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AskidaLayout.screenGutter,
              0,
              AskidaLayout.screenGutter,
              AskidaSpacing.s4,
            ),
            child: FilledButton.icon(
              key: const ValueKey('catalog-add'),
              onPressed: () => context.push(MerchantPaths.catalogNew),
              icon: const Icon(Icons.add),
              label: Text(l10n.merchantCatalogAdd),
            ),
          ),
        if (items.isEmpty)
          Padding(
            padding: const EdgeInsets.all(AskidaLayout.screenGutter),
            child: Text(
              editable
                  ? l10n.merchantCatalogEmptyOwner
                  : l10n.merchantCatalogEmptyStaff,
              style: theme.textTheme.bodyLarge?.copyWith(color: c.textMuted),
            ),
          ),
        for (final item in items)
          _ItemRow(
            key: ValueKey('item-${item.id}'),
            item: item,
            editable: editable,
          ),
      ],
    );
  }
}

class _ItemRow extends ConsumerStatefulWidget {
  const new({required this.item, required this.editable, super.key});

  final Item item;
  final bool editable;

  @override
  ConsumerState<_ItemRow> createState() => _ItemRowState();
}

class _ItemRowState extends ConsumerState<_ItemRow> {
  bool _saving = false;

  Future<void> _toggle(bool active) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = context.l10n;
    setState(() => _saving = true);
    try {
      await ref
          .read(catalogProvider.notifier)
          .setActive(widget.item, active: active);
    } on Object catch (error) {
      messenger.showSnackBar(
        SnackBar(content: Text(errorMessage(l10n, error))),
      );
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final item = widget.item;
    final price = Money(item.priceMinor).format(l10n.localeName);
    return MerchantRow(
      leading: AskidaTag(
        width: 32,
        height: 40,
        tone: item.active ? AskidaTagTone.accent : AskidaTagTone.secondary,
        child: Icon(categoryIcon(item.category), size: 16),
      ),
      title: item.name,
      subtitle: [
        categoryLabel(l10n, item.category),
        price,
        l10n.merchantCatalogDailyCap(item.dailyCap),
        if (!item.active) l10n.merchantCatalogInactive,
      ].join(' · '),
      onTap: widget.editable
          ? () => context.push(MerchantPaths.catalogItem(item.id))
          : null,
      trailing: widget.editable
          ? Semantics(
              label: l10n.merchantCatalogActiveToggle(item.name),
              child: Switch(
                value: item.active,
                onChanged: _saving ? null : _toggle,
              ),
            )
          : null,
    );
  }
}
