import 'package:askida/data/session.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Which identity a location needs.
enum RouteRequirement { none, merchant, donor, anon }

RouteRequirement requirementOf(String path) {
  if (path.startsWith(AppPaths.merchantOnlyPrefix)) {
    return RouteRequirement.merchant;
  }
  if (AppPaths.donorOnlyPrefixes.any(path.startsWith)) {
    return RouteRequirement.donor;
  }
  if (AppPaths.anonOnlyPrefixes.any(path.startsWith)) {
    return RouteRequirement.anon;
  }
  return RouteRequirement.none;
}

String _withFrom(String target, Uri location) => Uri(
  path: target,
  queryParameters: {'from': location.toString()},
).toString();

/// The app-wide redirect.
///
/// * Merchant screens below `/merchant` need a signed-in merchant, donor-only
///   screens a signed-in donor: without an account the user goes to
///   [AppPaths.auth] with `from`; with the other kind of account to the
///   mode home (which explains the account it needs).
/// * Anon screens need the anon token: otherwise [AppPaths.anonEntry] with
///   `from`.
/// * Until the session is restored nothing is redirected; the router
///   re-runs this when the session changes.
String? guardRedirect(Uri location, SessionState session) {
  final requirement = requirementOf(location.path);
  if (requirement == RouteRequirement.none || !session.restored) return null;
  switch (requirement) {
    case RouteRequirement.merchant:
      if (session.isMerchant) return null;
      return session.isSignedIn
          ? AppMode.merchant.path
          : _withFrom(AppPaths.auth, location);
    case RouteRequirement.donor:
      if (session.isDonor) return null;
      return session.isSignedIn
          ? AppMode.donor.path
          : _withFrom(AppPaths.auth, location);
    case RouteRequirement.anon:
      if (session.hasAnonToken) return null;
      return _withFrom(AppPaths.anonEntry, location);
    case RouteRequirement.none:
      return null;
  }
}

/// Per-route form of [guardRedirect] for feature routes that want it
/// explicitly (`GoRoute(redirect: sessionGuard, ...)`).
String? sessionGuard(BuildContext context, GoRouterState state) =>
    guardRedirect(
      state.uri,
      ProviderScope.containerOf(context, listen: false).read(sessionProvider),
    );
