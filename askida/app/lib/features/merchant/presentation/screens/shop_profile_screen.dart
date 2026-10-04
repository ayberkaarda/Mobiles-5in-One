import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/features/merchant/presentation/widgets/shop_form_fields.dart';
import 'package:askida/features/merchant/presentation/widgets/verification_banner.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The owner's shop details: verification state, masked identifiers and
/// an edit form. Changing sensitive details may send the shop back to
/// review (the server decides).
class ShopProfileScreen extends ConsumerWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = context.l10n;
    final shop = ref.watch(merchantShopProvider);
    final owner = shop.value?.owner;
    return MerchantPage(
      title: l10n.merchantProfileTitle,
      child: switch (shop) {
        AsyncData() when owner != null => _ProfileForm(
          key: ValueKey(owner.id),
          shop: owner,
        ),
        AsyncData() => ProblemView(
          error: const ApiProblem(code: 'network.offline', status: 0),
          onRetry: () => ref.read(merchantShopProvider.notifier).reload(),
        ),
        AsyncError(:final error) => ProblemView(
          error: error,
          onRetry: () => ref.read(merchantShopProvider.notifier).reload(),
        ),
        _ => const Center(child: CircularProgressIndicator()),
      },
    );
  }
}

class _ProfileForm extends ConsumerStatefulWidget {
  const new({required this.shop, super.key});

  final OwnerShop shop;

  @override
  ConsumerState<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends ConsumerState<_ProfileForm> {
  final _form = GlobalKey<FormState>();
  final _fields = ShopFormControllers();
  late bool _listedOnWeb;
  bool _busy = false;
  bool _saved = false;
  Map<String, FieldIssue> _server = const {};
  Object? _error;

  @override
  void initState() {
    super.initState();
    _fields.fillFrom(widget.shop);
    _listedOnWeb = widget.shop.listedOnWeb;
  }

  @override
  void dispose() {
    _fields.dispose();
    super.dispose();
  }

  ShopDraft _changes() {
    final shop = widget.shop;
    String? changed(String value, String current) {
      final trimmed = value.trim();
      return trimmed == current ? null : trimmed;
    }

    final phone = ShopRules.normalisePhone(_fields.phone.text);
    final tax = ShopRules.normaliseTaxNumber(_fields.taxNumber.text);
    final iban = ShopRules.normaliseIban(_fields.iban.text);
    return ShopDraft(
      name: changed(_fields.name.text, shop.name),
      phone: phone == shop.phone ? null : phone,
      address: changed(_fields.address.text, shop.address),
      il: changed(_fields.il.text, shop.il),
      ilce: changed(_fields.ilce.text, shop.ilce),
      taxNumber: tax.isEmpty ? null : tax,
      iban: iban.isEmpty ? null : iban,
      listedOnWeb: _listedOnWeb == shop.listedOnWeb ? null : _listedOnWeb,
    );
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    final changes = _changes();
    if (changes == const ShopDraft()) {
      setState(() => _saved = true);
      return;
    }
    setState(() {
      _busy = true;
      _saved = false;
      _error = null;
      _server = const {};
    });
    try {
      final updated = await ref
          .read(shopsRepositoryProvider)
          .update(widget.shop.id, changes);
      await ref.read(merchantShopProvider.notifier).ownerUpdated(updated);
      if (!mounted) return;
      setState(() {
        _busy = false;
        _saved = true;
      });
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
    final shop = widget.shop;
    FieldIssue? text(String v, int min, int max) =>
        ShopRules.text(v, min: min, max: max);
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
          VerificationBanner(state: shop.verificationState),
          const SizedBox(height: AskidaSpacing.s4),
          Text(
            l10n.merchantProfileMasked(
              shop.taxNumberMasked ?? '-',
              shop.ibanMasked ?? '-',
            ),
            style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          if (_error != null) ...[
            Text(
              errorMessage(l10n, _error!),
              key: const ValueKey('profile-error'),
              style: theme.textTheme.bodyMedium?.copyWith(color: c.dangerText),
            ),
            const SizedBox(height: AskidaSpacing.s4),
          ],
          ShopTextField(
            fieldKey: const ValueKey('profile-name'),
            controller: _fields.name,
            label: l10n.merchantFieldShopName,
            validate: (v) => text(v, ShopRules.nameMin, ShopRules.nameMax),
            serverIssue: _server['name'],
          ),
          ShopTextField(
            controller: _fields.phone,
            label: l10n.merchantFieldPhone,
            keyboardType: TextInputType.phone,
            validate: ShopRules.phone,
            serverIssue: _server['phone'],
          ),
          ShopTextField(
            controller: _fields.address,
            label: l10n.merchantFieldAddress,
            validate: (v) =>
                text(v, ShopRules.addressMin, ShopRules.addressMax),
            serverIssue: _server['address'],
          ),
          ShopTextField(
            controller: _fields.il,
            label: l10n.merchantFieldIl,
            validate: (v) => text(v, ShopRules.placeMin, ShopRules.placeMax),
            serverIssue: _server['il'],
          ),
          ShopTextField(
            controller: _fields.ilce,
            label: l10n.merchantFieldIlce,
            validate: (v) => text(v, ShopRules.placeMin, ShopRules.placeMax),
            serverIssue: _server['ilce'],
          ),
          ShopTextField(
            controller: _fields.taxNumber,
            label: l10n.merchantFieldNewTaxNumber,
            hint: l10n.merchantFieldKeepBlank,
            keyboardType: TextInputType.number,
            validate: (v) => v.trim().isEmpty ? null : ShopRules.taxNumber(v),
            serverIssue: _server['tax_number'],
          ),
          ShopTextField(
            controller: _fields.iban,
            label: l10n.merchantFieldNewIban,
            hint: l10n.merchantFieldKeepBlank,
            textInputAction: TextInputAction.done,
            validate: (v) => v.trim().isEmpty ? null : ShopRules.iban(v),
            serverIssue: _server['iban'],
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _listedOnWeb,
            onChanged: (value) => setState(() => _listedOnWeb = value),
            title: Text(l10n.merchantFieldListedOnWeb),
            subtitle: Text(l10n.merchantFieldListedOnWebHint),
          ),
          const SizedBox(height: AskidaSpacing.s2),
          Text(
            l10n.merchantProfileReviewNote,
            style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
          ),
          const SizedBox(height: AskidaSpacing.s4),
          if (_saved)
            Padding(
              padding: const EdgeInsets.only(bottom: AskidaSpacing.s3),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  l10n.merchantProfileSaved,
                  key: const ValueKey('profile-saved'),
                  style: theme.textTheme.bodyMedium?.copyWith(color: c.success),
                ),
              ),
            ),
          FilledButton(
            key: const ValueKey('profile-save'),
            onPressed: _busy ? null : _save,
            child: Text(_busy ? l10n.merchantSending : l10n.merchantSave),
          ),
        ],
      ),
    );
  }
}
