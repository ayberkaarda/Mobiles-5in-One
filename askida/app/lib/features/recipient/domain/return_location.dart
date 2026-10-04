import 'package:askida/routing/app_mode.dart';

/// Where the anonymous entry returns after attesting. Only recipient
/// locations are accepted (the `from` value arrives in a URL and must not
/// send the user anywhere else); anything else returns to the recipient
/// home.
String safeReturnLocation(String? from) {
  final home = AppMode.recipient.path;
  if (from == null || from.isEmpty) return home;
  final uri = Uri.tryParse(from);
  if (uri == null || uri.hasScheme || uri.hasAuthority) return home;
  final path = uri.path;
  final inRecipient = path == home || path.startsWith('$home/');
  if (!inRecipient || path.startsWith('$home/start') || path.contains('..')) {
    return home;
  }
  return uri.toString();
}
