import 'package:askida/design/empty_state.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

class RecipientHomeScreen extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return EmptyState(
      icon: Icons.shopping_bag_outlined,
      title: l10n.recipientEmptyTitle,
      body: l10n.recipientEmptyBody,
    );
  }
}
