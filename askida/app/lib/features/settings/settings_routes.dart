import 'package:askida/features/settings/presentation/delete_account_screen.dart';
import 'package:askida/features/settings/presentation/settings_screen.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:go_router/go_router.dart';

/// Top-level settings routes: `/settings` (open to everyone: language and
/// theme need no account) and `/settings/delete-account` (asks signed-out
/// users to sign in first; it stays open after the deletion signs out, to
/// show the grace date).
final List<RouteBase> settingsRoutes = <RouteBase>[
  GoRoute(
    path: AppPaths.settings,
    builder: (context, state) => const SettingsScreen(),
    routes: [
      GoRoute(
        path: 'delete-account',
        builder: (context, state) => const DeleteAccountScreen(),
      ),
    ],
  ),
];
