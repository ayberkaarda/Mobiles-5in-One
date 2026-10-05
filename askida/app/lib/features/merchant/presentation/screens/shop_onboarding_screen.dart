import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/features/merchant/merchant_paths.dart';
import 'package:askida/features/merchant/presentation/providers/merchant_shop_controller.dart';
import 'package:askida/features/merchant/presentation/widgets/map_pin_picker.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/features/merchant/presentation/widgets/shop_form_fields.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Shop registration in three steps: details, address and map pin, review.
/// The new shop starts `pending`; documents come next.
class ShopOnboardingScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<ShopOnboardingScreen> createState() =>
      _ShopOnboardingScreenState();
}

class _ShopOnboardingScreenState extends ConsumerState<ShopOnboardingScreen> {
  static const _stepFields = [
    {'name', 'type', 'phone', 'tax_number', 'iban', 'listed_on_web'},
    {'address', 'il', 'ilce', 'lat', 'lng'},
  ];

  final _forms = [GlobalKey<FormState>(), GlobalKey<FormState>()];
  final _fields = ShopFormControllers();
  ShopType? _type;
  bool _listedOnWeb = true;
  GeoPoint? _pin;
  bool _pinMissing = false;
  int _step = 0;
  bool _busy = false;
  Map<String, FieldIssue> _server = const {};
  Object? _error;

  @override
  void dispose() {
    _fields.dispose();
    super.dispose();
  }

  void _next() {
    if (_step < 2) {
      final valid = _forms[_step].currentState?.validate() ?? false;
      final pinOk = _step != 1 || _pin != null;
      setState(() => _pinMissing = !pinOk);
      if (!valid || !pinOk) return;
    }
    setState(() {
      _step++;
      _error = null;
    });
  }

  void _back() {
    if (_step == 0) {
      context.pop();
    } else {
      setState(() => _step--);
    }
  }

  ShopDraft _draft() => ShopDraft(
    name: _fields.name.text.trim(),
    type: _type,
    phone: ShopRules.normalisePhone(_fields.phone.text),
    taxNumber: ShopRules.normaliseTaxNumber(_fields.taxNumber.text),
    iban: ShopRules.normaliseIban(_fields.iban.text),
    address: _fields.address.text.trim(),
    il: _fields.il.text.trim(),
    ilce: _fields.ilce.text.trim(),
    lat: _pin?.lat,
    lng: _pin?.lng,
    listedOnWeb: _listedOnWeb,
  );

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _server = const {};
    });
    try {
      final shop = await ref.read(shopsRepositoryProvider).create(_draft());
      await ref.read(merchantShopProvider.notifier).registered(shop);
      if (!mounted) return;
      context.go(MerchantPaths.documents);
    } on ApiProblem catch (problem) {
      if (!mounted) return;
      final issues = serverIssues(problem);
      final firstStep = _stepFields.indexWhere(
        (fields) => fields.any(issues.containsKey),
      );
      setState(() {
        _busy = false;
        _server = issues;
        _error = problem;
        if (firstStep >= 0) _step = firstStep;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final titles = [
      l10n.merchantWizardDetailsTitle,
      l10n.merchantWizardLocationTitle,
      l10n.merchantWizardReviewTitle,
    ];
    return PopScope(
      canPop: _step == 0,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _back();
      },
      child: MerchantPage(
        title: l10n.merchantRegisterShop,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            AskidaLayout.screenGutter,
            0,
            AskidaLayout.screenGutter,
            AskidaSpacing.s8,
          ),
          children: [
            Semantics(
              liveRegion: true,
              child: Text(
                l10n.merchantWizardStep(_step + 1, 3),
                style: Theme.of(context).textTheme.labelMedium
                    ?.copyWith(color: AskidaColors.of(context).textMuted),
              ),
            ),
            const SizedBox(height: AskidaSpacing.s1),
            Text(titles[_step], style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: AskidaSpacing.s4),
            if (_error != null) ...[
              Text(
                errorMessage(l10n, _error!),
                key: const ValueKey('wizard-error'),
                style: Theme.of(context).textTheme.bodyMedium
                    ?.copyWith(color: AskidaColors.of(context).dangerText),
              ),
              const SizedBox(height: AskidaSpacing.s4),
            ],
            switch (_step) {
              0 => _detailsStep(),
              1 => _locationStep(),
              _ => _reviewStep(),
            },
            const SizedBox(height: AskidaSpacing.s4),
            if (_step < 2)
              FilledButton(
                key: const ValueKey('wizard-next'),
                onPressed: _next,
                child: Text(l10n.merchantContinue),
              )
            else
              FilledButton(
                key: const ValueKey('wizard-submit'),
                onPressed: _busy ? null : _submit,
                child: Text(
                  _busy ? l10n.merchantSending : l10n.merchantWizardSubmit,
                ),
              ),
            if (_step > 0) ...[
              const SizedBox(height: AskidaSpacing.s2),
              TextButton(onPressed: _back, child: Text(l10n.merchantBack)),
            ],
          ],
        ),
      ),
    );
  }

  Widget _detailsStep() {
    final l10n = context.l10n;
    return Form(
      key: _forms[0],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ShopTextField(
            fieldKey: const ValueKey('field-name'),
            controller: _fields.name,
            label: l10n.merchantFieldShopName,
            validate: (v) => ShopRules.text(
              v,
              min: ShopRules.nameMin,
              max: ShopRules.nameMax,
            ),
            serverIssue: _server['name'],
          ),
          ShopTypeField(
            value: _type,
            onChanged: (type) => setState(() => _type = type),
          ),
          ShopTextField(
            fieldKey: const ValueKey('field-phone'),
            controller: _fields.phone,
            label: l10n.merchantFieldPhone,
            hint: l10n.merchantFieldPhoneHint,
            keyboardType: TextInputType.phone,
            validate: ShopRules.phone,
            serverIssue: _server['phone'],
          ),
          ShopTextField(
            fieldKey: const ValueKey('field-tax'),
            controller: _fields.taxNumber,
            label: l10n.merchantFieldTaxNumber,
            keyboardType: TextInputType.number,
            validate: ShopRules.taxNumber,
            serverIssue: _server['tax_number'],
          ),
          ShopTextField(
            fieldKey: const ValueKey('field-iban'),
            controller: _fields.iban,
            label: l10n.merchantFieldIban,
            hint: l10n.merchantFieldIbanHint,
            validate: ShopRules.iban,
            serverIssue: _server['iban'],
          ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _listedOnWeb,
            onChanged: (value) => setState(() => _listedOnWeb = value),
            title: Text(l10n.merchantFieldListedOnWeb),
            subtitle: Text(l10n.merchantFieldListedOnWebHint),
          ),
        ],
      ),
    );
  }

  Widget _locationStep() {
    final l10n = context.l10n;
    return Form(
      key: _forms[1],
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          ShopTextField(
            fieldKey: const ValueKey('field-address'),
            controller: _fields.address,
            label: l10n.merchantFieldAddress,
            validate: (v) => ShopRules.text(
              v,
              min: ShopRules.addressMin,
              max: ShopRules.addressMax,
            ),
            serverIssue: _server['address'],
          ),
          ShopTextField(
            fieldKey: const ValueKey('field-il'),
            controller: _fields.il,
            label: l10n.merchantFieldIl,
            validate: (v) => ShopRules.text(
              v,
              min: ShopRules.placeMin,
              max: ShopRules.placeMax,
            ),
            serverIssue: _server['il'],
          ),
          ShopTextField(
            fieldKey: const ValueKey('field-ilce'),
            controller: _fields.ilce,
            label: l10n.merchantFieldIlce,
            textInputAction: TextInputAction.done,
            validate: (v) => ShopRules.text(
              v,
              min: ShopRules.placeMin,
              max: ShopRules.placeMax,
            ),
            serverIssue: _server['ilce'],
          ),
          MapPinPicker(
            pin: _pin,
            center: initialMapCenter(
              il: _fields.il.text,
              ilce: _fields.ilce.text,
            ),
            onChanged: (point) => setState(() {
              _pin = point;
              _pinMissing = false;
            }),
          ),
          if (_pinMissing || _server.containsKey('lat'))
            Padding(
              padding: const EdgeInsets.only(top: AskidaSpacing.s2),
              child: Text(
                _pinMissing
                    ? l10n.merchantMapPinRequired
                    : l10n.merchantMapPinOutside,
                key: const ValueKey('pin-error'),
                style: Theme.of(context).textTheme.bodySmall
                    ?.copyWith(color: AskidaColors.of(context).dangerText),
              ),
            ),
        ],
      ),
    );
  }

  Widget _reviewStep() {
    final l10n = context.l10n;
    final type = _type;
    final rows = <(String, String)>[
      (l10n.merchantFieldShopName, _fields.name.text.trim()),
      (
        l10n.merchantFieldShopType,
        type == null ? '' : shopTypeLabel(l10n, type),
      ),
      (
        l10n.merchantFieldPhone,
        ShopRules.normalisePhone(_fields.phone.text) ?? '',
      ),
      (
        l10n.merchantFieldAddress,
        '${_fields.address.text.trim()}, '
            '${_fields.ilce.text.trim()} / ${_fields.il.text.trim()}',
      ),
      (
        l10n.merchantFieldListedOnWeb,
        _listedOnWeb ? l10n.merchantYes : l10n.merchantNo,
      ),
    ];
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final (label, value) in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AskidaSpacing.s3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: c.textMuted,
                  ),
                ),
                Text(value, style: theme.textTheme.bodyLarge),
              ],
            ),
          ),
        Text(
          l10n.merchantWizardReviewNote,
          style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
        ),
      ],
    );
  }
}
