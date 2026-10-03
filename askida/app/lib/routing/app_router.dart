import 'package:askida/features/donor/donor_home_screen.dart';
import 'package:askida/features/merchant/merchant_home_screen.dart';
import 'package:askida/features/recipient/recipient_home_screen.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:askida/routing/mode_shell.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

GoRouter buildAppRouter({AppMode initialMode = AppMode.initial}) => GoRouter(
  initialLocation: initialMode.path,
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
              ),
            ],
          ),
      ],
    ),
  ],
);

Widget _homeFor(AppMode mode) => switch (mode) {
  AppMode.donor => const DonorHomeScreen(),
  AppMode.merchant => const MerchantHomeScreen(),
  AppMode.recipient => const RecipientHomeScreen(),
};

final appRouterProvider = Provider<GoRouter>((ref) {
  final router = buildAppRouter();
  ref.onDispose(router.dispose);
  return router;
});
