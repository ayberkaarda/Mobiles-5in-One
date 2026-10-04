import 'package:askida/features/auth/auth_routes.dart';
import 'package:askida/features/donor/donor_routes.dart';
import 'package:askida/features/merchant/merchant_routes.dart';
import 'package:askida/features/recipient/recipient_routes.dart';
import 'package:askida/features/settings/settings_routes.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:go_router/go_router.dart';

/// Route registry. Each feature owns one list in
/// `lib/features/<feature>/<feature>_routes.dart`:
///
/// * `recipientRoutes`, `donorRoutes`, `merchantRoutes`: child routes of the
///   mode home (relative paths), shown inside the mode shell.
/// * `authRoutes`, `settingsRoutes`: top-level routes (absolute paths),
///   shown full screen above the shell.

/// Child routes of [mode]'s home route.
List<RouteBase> modeChildRoutes(AppMode mode) => switch (mode) {
  AppMode.recipient => recipientRoutes,
  AppMode.donor => donorRoutes,
  AppMode.merchant => merchantRoutes,
};

/// Routes registered next to the shell.
List<RouteBase> get topLevelFeatureRoutes => [...authRoutes, ...settingsRoutes];

/// Every feature route, in registry order.
List<RouteBase> get allFeatureRoutes => [
  ...authRoutes,
  ...recipientRoutes,
  ...merchantRoutes,
  ...donorRoutes,
  ...settingsRoutes,
];
