import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/shop.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/merchant/domain/shop_rules.dart';
import 'package:askida/features/merchant/presentation/widgets/merchant_page.dart';
import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

/// Copy for a shop type.
String shopTypeLabel(AppLocalizations l10n, ShopType type) => switch (type) {
  ShopType.bakery => l10n.merchantShopTypeBakery,
  ShopType.restaurant => l10n.merchantShopTypeRestaurant,
  ShopType.grocery => l10n.merchantShopTypeGrocery,
  ShopType.stationery => l10n.merchantShopTypeStationery,
  ShopType.cafe => l10n.merchantShopTypeCafe,
  ShopType.other => l10n.merchantShopTypeOther,
};

/// A server rule code (`required`, `min`, `max`, `between`, ...) as a form
/// issue.
FieldIssue issueFromRule(String code) => switch (code) {
  'required' || 'required_with' => FieldIssue.required,
  'min' => FieldIssue.tooShort,
  'max' || 'size' => FieldIssue.tooLong,
  'between' => FieldIssue.outOfRange,
  _ => FieldIssue.invalid,
};

/// The first issue the server reported for each field of [problem].
Map<String, FieldIssue> serverIssues(ApiProblem problem) => {
  for (final error in problem.fieldErrors.reversed)
    error.field: issueFromRule(error.code),
};

/// Text controllers of the shop form, shared by the onboarding wizard and
/// the profile screen.
class ShopFormControllers {
  final name = TextEditingController();
  final phone = TextEditingController();
  final taxNumber = TextEditingController();
  final iban = TextEditingController();
  final address = TextEditingController();
  final il = TextEditingController();
  final ilce = TextEditingController();

  void fillFrom(OwnerShop shop) {
    name.text = shop.name;
    phone.text = shop.phone;
    address.text = shop.address;
    il.text = shop.il;
    ilce.text = shop.ilce;
  }

  void dispose() {
    for (final c in [name, phone, taxNumber, iban, address, il, ilce]) {
      c.dispose();
    }
  }
}

/// A labelled text field with the merchant form conventions: the label is
/// the accessible name, client issues come from [validate], server issues
/// from [serverIssue].
class ShopTextField extends StatelessWidget {
  const new({
    required this.controller,
    required this.label,
    this.validate,
    this.serverIssue,
    this.hint,
    this.keyboardType,
    this.textInputAction = TextInputAction.next,
    this.fieldKey,
    this.maxLines = 1,
    super.key,
  });

  final TextEditingController controller;
  final String label;
  final FieldIssue? Function(String value)? validate;
  final FieldIssue? serverIssue;
  final String? hint;
  final TextInputType? keyboardType;
  final TextInputAction textInputAction;
  final Key? fieldKey;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Padding(
      padding: const EdgeInsets.only(bottom: AskidaSpacing.s4),
      child: TextFormField(
        key: fieldKey,
        controller: controller,
        keyboardType: keyboardType,
        textInputAction: textInputAction,
        maxLines: maxLines,
        decoration: InputDecoration(
          labelText: label,
          helperText: hint,
          helperMaxLines: 3,
          errorMaxLines: 3,
          errorText: issueText(l10n, serverIssue),
        ),
        validator: validate == null
            ? null
            : (value) => issueText(l10n, validate!(value ?? '')),
      ),
    );
  }
}

/// Shop type picker.
class ShopTypeField extends StatelessWidget {
  const new({required this.value, required this.onChanged, super.key});

  final ShopType? value;
  final ValueChanged<ShopType?> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Padding(
      padding: const EdgeInsets.only(bottom: AskidaSpacing.s4),
      child: DropdownButtonFormField<ShopType>(
        key: const ValueKey('shop-type'),
        initialValue: value,
        isExpanded: true,
        decoration: InputDecoration(labelText: l10n.merchantFieldShopType),
        items: [
          for (final type in ShopType.values)
            DropdownMenuItem(
              value: type,
              child: Text(
                shopTypeLabel(l10n, type),
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
        validator: (value) =>
            value == null ? issueText(l10n, FieldIssue.required) : null,
        onChanged: onChanged,
      ),
    );
  }
}
