import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

/// Opens links outside the app (store pages, legal pages on askida.app,
/// the account deletion page). Only HTTPS links to [allowedHosts] open;
/// anything else is refused without touching the platform.
abstract interface class ExternalLinks {
  /// True when the link was handed to the platform and it accepted it.
  Future<bool> open(Uri uri);
}

/// Hosts the app may open in the browser or a store app.
const Set<String> allowedHosts = {
  'askida.app',
  'play.google.com',
  'apps.apple.com',
};

/// The allowlist rule: `https`, a listed host, no user info, default port.
bool isAllowedExternalLink(Uri uri) =>
    uri.scheme == 'https' &&
    allowedHosts.contains(uri.host) &&
    uri.userInfo.isEmpty &&
    (!uri.hasPort || uri.port == 443);

/// Hands an allowed link to the platform.
typedef PlatformLauncher = Future<bool> Function(Uri uri);

Future<bool> _launchExternally(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

/// [ExternalLinks] over `url_launcher` (external browser or store app).
class UrlLauncherExternalLinks implements ExternalLinks {
  const new({this._launcher = _launchExternally});

  final PlatformLauncher _launcher;

  @override
  Future<bool> open(Uri uri) async {
    if (!isAllowedExternalLink(uri)) return false;
    try {
      return await _launcher(uri);
    } on Object {
      // No browser or store app: report "not opened", never crash.
      return false;
    }
  }
}

final externalLinksProvider = Provider<ExternalLinks>(
  (ref) => const UrlLauncherExternalLinks(),
);
