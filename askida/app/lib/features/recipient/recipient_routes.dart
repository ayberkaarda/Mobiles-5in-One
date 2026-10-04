import 'package:askida/features/recipient/presentation/code_screen.dart';
import 'package:askida/features/recipient/presentation/reserve_screen.dart';
import 'package:askida/features/recipient/presentation/shop_detail_screen.dart';
import 'package:askida/features/recipient/presentation/start_screen.dart';
import 'package:go_router/go_router.dart';

/// Child routes of `/recipient` (relative paths, inside the mode shell).
///
/// * `start`: anonymous entry (attestation), `?from=` set by the guards.
/// * `shop/:slug`: shop detail with counts.
/// * `reserve/:slug/:itemId`: confirm and reserve (anon token required).
/// * `code`: the code ticket (anon token required).
final List<RouteBase> recipientRoutes = <RouteBase>[
  GoRoute(
    path: 'start',
    builder: (context, state) =>
        RecipientStartScreen(from: state.uri.queryParameters['from']),
  ),
  GoRoute(
    path: 'shop/:slug',
    builder: (context, state) =>
        RecipientShopScreen(slug: state.pathParameters['slug']!),
  ),
  GoRoute(
    path: 'reserve/:slug/:itemId',
    builder: (context, state) => ReserveScreen(
      slug: state.pathParameters['slug']!,
      itemId: state.pathParameters['itemId']!,
    ),
  ),
  GoRoute(path: 'code', builder: (context, state) => const CodeScreen()),
];
