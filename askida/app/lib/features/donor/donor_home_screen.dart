import 'package:askida/design/empty_state.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';

class DonorHomeScreen extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return EmptyState(title: l10n.donorEmptyTitle, body: l10n.donorEmptyBody);
  }
}
