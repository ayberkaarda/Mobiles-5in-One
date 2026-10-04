import 'package:askida/features/donor/presentation/donate_screen.dart';
import 'package:askida/features/donor/presentation/donation_screens.dart';
import 'package:askida/features/donor/presentation/donor_shop_screen.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/widgets.dart';
import 'package:go_router/go_router.dart';

/// Child routes of `/donor` (relative): the shop's rail, the donation form
/// with the payment page, the receipt the pay page returns to, and the
/// history. The app guard keeps `donate*` and `donation*` for donors.
final List<RouteBase> donorRoutes = <RouteBase>[
  GoRoute(
    path: 'shop/:slug',
    builder: (context, state) =>
        DonorShopScreen(slug: state.pathParameters['slug']!),
  ),
  GoRoute(
    path: 'donate',
    redirect: (context, state) {
      final query = state.uri.queryParameters;
      final complete =
          (query['shop'] ?? '').isNotEmpty && (query['item'] ?? '').isNotEmpty;
      return complete ? null : AppMode.donor.path;
    },
    builder: (context, state) => DonateScreen(
      shopSlug: state.uri.queryParameters['shop']!,
      itemId: state.uri.queryParameters['item']!,
    ),
  ),
  GoRoute(
    path: 'donation/:id',
    builder: (context, state) => DonationReceiptScreen(
      key: ValueKey(state.uri.toString()),
      donationId: state.pathParameters['id']!,
      linkStatus: state.uri.queryParameters['status'],
    ),
  ),
  GoRoute(
    path: 'donations',
    builder: (context, state) => const DonationHistoryScreen(),
  ),
];
