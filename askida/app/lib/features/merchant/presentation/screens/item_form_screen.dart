import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/item.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_providers.dart';
import 'package:askida/features/merchant/presentation/screens/catalog_screen.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/features/merchant/presentation/widgets/shop_form_fields.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Adds an item ([itemId] null) or edits one of the catalog.
class ItemFormScreen extends ConsumerWidget {
  const new({this.itemId, super.key});

  final String? itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final title = itemId == null
        ? l10n.merchantItemNewTitle
        : l10n.merchantItemEditTitle;
    final id = itemId;
    if (id == null) {
      return MerchantPage(title: title, child: const _ItemForm());
    }
    final catalog = ref.watch(catalogProvider);
    return MerchantPage(
      title: title,
      child: switch (catalog) {
        AsyncData(:final value) => switch (value
            .where((i) => i.id == id)
            .firstOrNull) {
          final Item item => _ItemForm(item: item),
          null => ProblemView(
            error: const ApiProblem(code: 'not_found', status: 404),
            onRetry: () => ref.invalidate(catalogProvider),
          ),
        },
        AsyncError(:final error) => ProblemView(
          error: error,
          onRetry: () => ref.invalidate(catalogProvider),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _ItemForm extends ConsumerStatefulWidget {
  const new({this.item});

  final Item? item;

  @override
  ConsumerState<_ItemForm> createState() => _ItemFormState();
}

class _ItemFormState extends ConsumerState<_ItemForm> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _price;
  late final TextEditingController _cap;
  late ItemCategory? _category;
  late bool _active;
  bool _busy = false;
  Map<String, FieldIssue> _server = const {};
  Object? _error;

  @override
  void initState() {
    super.initState();
    final item = widget.item;
    _name = TextEditingController(text: item?.name ?? '');
    _price = TextEditingController(
      text: item == null ? '' : ItemRules.priceInput(item.priceMinor),
    );
    _cap = TextEditingController(text: item == null ? '' : '${item.dailyCap}');
    _category = item?.category;
    _active = item?.active ?? true;
  }

  @override
  void dispose() {
    _name.dispose();
    _price.dispose();
    _cap.dispose();
    super.dispose();
  }

  /// The fields that differ from the edited item (all fields for a new one).
  ItemDraft _draft() {
    final item = widget.item;
    final name = _name.text.trim();
    final price = ItemRules.parsePriceMinor(_price.text);
    final cap = int.tryParse(_cap.text.trim());
    if (item == null) {
      return ItemDraft(
        name: name,
        category: _category,
        priceMinor: price,
        dailyCap: cap,
        active: _active,
      );
    }
    return ItemDraft(
      name: name == item.name ? null : name,
      category: _category == item.category ? null : _category,
      priceMinor: price == item.priceMinor ? null : price,
      dailyCap: cap == item.dailyCap ? null : cap,
      active: _active == item.active ? null : _active,
    );
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    final draft = _draft();
    final item = widget.item;
    if (item != null && draft == const ItemDraft()) {
      context.pop();
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _server = const {};
    });
    final catalog = ref.read(catalogProvider.notifier);
    try {
      if (item == null) {
        await catalog.add(draft);
      } else {
        await catalog.save(item.id, draft);
      }
      if (!mounted) return;
      context.pop();
    } on ApiProblem catch (problem) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = problem;
        _server = serverIssues(problem);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AskidaLayout.screenGutter,
          0,
          AskidaLayout.screenGutter,
          AskidaSpacing.s8,
        ),
        children: [
          if (_error != null) ...[
            Text(
              errorMessage(l10n, _error!),
              key: const ValueKey('item-error'),
              style: theme.textTheme.bodyMedium?.copyWith(color: c.dangerText),
            ),
            const SizedBox(height: AskidaSpacing.s4),
          ],
          ShopTextField(
            fieldKey: const ValueKey('item-name'),
            controller: _name,
            label: l10n.merchantItemName,
            hint: l10n.merchantItemNameHint,
            validate: ItemRules.name,
            serverIssue: _server['name'],
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: AskidaSpacing.s4),
            child: DropdownButtonFormField<ItemCategory>(
              key: const ValueKey('item-category'),
              initialValue: _category,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.merchantItemCategory,
                errorText: issueText(l10n, _server['category']),
              ),
              items: [
                for (final category in ItemCategory.values)
                  DropdownMenuItem(
                    value: category,
                    child: Text(categoryLabel(l10n, category)),
                  ),
              ],
              validator: (value) =>
                  value == null ? issueText(l10n, FieldIssue.required) : null,
              onChanged: (value) => setState(() => _category = value),
            ),
          ),
          ShopTextField(
            fieldKey: const ValueKey('item-price'),
            controller: _price,
            label: l10n.merchantItemPrice,
            hint: l10n.merchantItemPriceHint,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            validate: ItemRules.price,
            serverIssue: _server['price_minor'],
          ),
          ShopTextField(
            fieldKey: const ValueKey('item-cap'),
            controller: _cap,
            label: l10n.merchantItemDailyCap,
            hint: l10n.merchantItemDailyCapHint,
            keyboardType: TextInputType.number,
            textInputAction: TextInputAction.done,
            validate: ItemRules.dailyCap,
            serverIssue: _server['daily_cap'],
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _active,
            onChanged: (value) => setState(() => _active = value),
            title: Text(l10n.merchantItemActive),
            subtitle: Text(l10n.merchantItemActiveHint),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          FilledButton(
            key: const ValueKey('item-save'),
            onPressed: _busy ? null : _save,
            child: Text(_busy ? l10n.merchantSending : l10n.merchantSave),
          ),
        ],
      ),
    );
  }
}
