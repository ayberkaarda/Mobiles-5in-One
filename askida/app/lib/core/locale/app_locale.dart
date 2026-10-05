import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Language chosen in settings; null means the default (Turkish). The app
/// and the `Accept-Language` header both read it.
class AppLocaleController extends Notifier<Locale?> {
  @override
  Locale? build() => null;

  // A setter would read oddly at call sites (`notifier.locale = x`).
  // ignore: use_setters_to_change_properties
  void set(Locale? locale) => state = locale;
}

final appLocaleProvider = NotifierProvider<AppLocaleController, Locale?>(
  AppLocaleController.new,
);

/// Language tag for API requests.
final apiLanguageProvider = Provider<String>(
  (ref) => ref.watch(appLocaleProvider)?.languageCode ?? 'tr',
);
