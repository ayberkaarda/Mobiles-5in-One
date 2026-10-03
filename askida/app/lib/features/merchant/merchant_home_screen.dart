import 'package:askida/design/empty_state.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

class MerchantHomeScreen extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return EmptyState(
      icon: Icons.storefront_outlined,
      title: l10n.merchantEmptyTitle,
      body: l10n.merchantEmptyBody,
    );
  }
}
