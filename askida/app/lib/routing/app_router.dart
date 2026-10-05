import 'dart:async';

import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/donor/donor_home_screen.dart';
import 'package:askida/features/merchant/merchant_home_screen.dart';
import 'package:askida/features/recipient/recipient_home_screen.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:askida/routing/deep_links.dart';
import 'package:askida/routing/feature_routes.dart';
import 'package:askida/routing/guards.dart';
import 'package:askida/routing/mode_shell.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// Remembers the mode of the last mode location, so unknown links and
/// shop links open in the mode the user is in.
class ModeTracker {
  new([this.current = AppMode.initial]);

  AppMode current;

  void observe(Uri location) {
    final mode = AppPaths.modeOf(location.path);
    if (mode != null) current = mode;
  }
}

final modeTrackerProvider = Provider<ModeTracker>((ref) => ModeTracker());

GoRouter buildAppRouter({
  SessionState Function()? readSession,
  Listenable? refreshListenable,
  AppMode initialMode = AppMode.initial,
  String? initialLocation,
  ModeTracker? modes,
  List<RouteBase> Function(AppMode mode) childRoutesFor = modeChildRoutes,
  List<RouteBase>? topLevelRoutes,
}) {
  final tracker = modes ?? ModeTracker(initialMode);
  final session = readSession ?? () => const SessionState();
  return GoRouter(
    initialLocation: initialLocation ?? initialMode.path,
    refreshListenable: refreshListenable,
    redirect: (context, state) {
      tracker.observe(state.uri);
      return guardRedirect(state.uri, session());
    },
    // Unknown locations (stale links, removed screens) land on the home of
    // the current mode instead of an error page.
    onException: (context, state, router) => router.go(tracker.current.path),
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            ModeShell(navigationShell: navigationShell),
        branches: [
          for (final mode in AppMode.values)
            StatefulShellBranch(
              routes: [
                GoRoute(
                  path: mode.path,
                  name: mode.name,
                  builder: (context, state) => _homeFor(mode),
                  routes: childRoutesFor(mode),
                ),
              ],
            ),
        ],
      ),
      ...(topLevelRoutes ?? topLevelFeatureRoutes),
    ],
  );
}

Widget _homeFor(AppMode mode) => switch (mode) {
  AppMode.donor => const DonorHomeScreen(),
  AppMode.merchant => const MerchantHomeScreen(),
  AppMode.recipient => const RecipientHomeScreen(),
};

/// Opens [uri] in [router]: known links go to their screen in the current
/// mode, anything else to the current mode home.
void openDeepLink(GoRouter router, ModeTracker tracker, Uri uri) =>
    router.go(locationForLink(parseDeepLink(uri), tracker.current));

/// Re-runs the redirect whenever the session changes.
class _SessionRefresh extends ChangeNotifier {
  void changed() => notifyListeners();
}

final appRouterProvider = Provider<GoRouter>((ref) {
  final refresh = _SessionRefresh();
  ref.listen(sessionProvider, (_, _) => refresh.changed());
  final tracker = ref.watch(modeTrackerProvider);
  final router = buildAppRouter(
    readSession: () => ref.read(sessionProvider),
    refreshListenable: refresh,
    modes: tracker,
  );
  final links = ref
      .watch(deepLinkSourceProvider)
      .links
      .listen(
        (uri) => openDeepLink(router, tracker, uri),
        // A platform without the links plugin simply has no links.
        onError: (Object _) {},
      );
  // Loads the stored identity; the guards wait for it.
  unawaited(ref.read(sessionRestoreProvider.future).catchError((Object _) {}));
  ref.onDispose(() {
    unawaited(links.cancel());
    router.dispose();
    refresh.dispose();
  });
  return router;
});
