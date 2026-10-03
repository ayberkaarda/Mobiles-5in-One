import 'package:askida/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';

/// The three modes of the single app. The enum order is the navigation order
/// and the branch index of the shell.
enum AppMode {
  donor('/donor', Icons.volunteer_activism_outlined),
  merchant('/merchant', Icons.storefront_outlined),
  recipient('/recipient', Icons.shopping_bag_outlined);

  new(this.path, this.icon);

  /// Route path of the mode home screen.
  final String path;
  final IconData icon;

  /// Mode a fresh launch opens in: taking from the hook needs no account,
  /// so it is reachable from the first screen.
  static const AppMode initial = AppMode.recipient;

  String label(AppLocalizations l10n) => switch (this) {
    AppMode.donor => l10n.modeDonor,
    AppMode.merchant => l10n.modeMerchant,
    AppMode.recipient => l10n.modeRecipient,
  };
}
