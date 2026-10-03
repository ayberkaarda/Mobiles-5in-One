import 'package:askida/l10n/gen/app_localizations.dart';

/// The three modes of the single app. The enum order is the order of the
/// mode switcher (Askıdan al · Askıya bırak · Esnaf) and the branch index of
/// the shell.
enum AppMode {
  recipient('/recipient'),
  donor('/donor'),
  merchant('/merchant');

  new(this.path);

  /// Route path of the mode home screen.
  final String path;

  /// Mode a fresh launch opens in: taking from the rail needs no account,
  /// so it is reachable from the first screen.
  static const AppMode initial = AppMode.recipient;

  String label(AppLocalizations l10n) => switch (this) {
    AppMode.donor => l10n.modeDonor,
    AppMode.merchant => l10n.modeMerchant,
    AppMode.recipient => l10n.modeRecipient,
  };
}
