import 'package:askida/core/webview/checkout_webview.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:askida/features/donor/presentation/donate_screen.dart';
import 'package:askida/features/settings/data/settings_store.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../fakes/fake_auth_repository.dart';
import '../../fakes/fake_donations_repository.dart';
import '../../fakes/fake_identity_provider.dart';
import '../../fakes/fake_location_service.dart';
import '../../fakes/fake_misc_repositories.dart';
import '../../fakes/fake_push_service.dart';
import '../../fakes/fake_shops_repository.dart';
import '../../fakes/fake_tile_provider.dart';
import '../../helpers/pump_app.dart';

/// Forwards session events of a fake repository to the app's session once
/// the app has created it.
class ForwardingSessionSink implements SessionSink {
  SessionSink? target;

  @override
  void signedIn(User user) => target?.signedIn(user);
  @override
  void userUpdated(User user) => target?.userUpdated(user);
  @override
  void signedOut() => target?.signedOut();
  @override
  void anonStored() => target?.anonStored();
  @override
  void anonCleared() => target?.anonCleared();
}

/// A checkout view that never touches a platform WebView: it runs the
/// navigations in [navigations] through the real allowlist policy and
/// shows which ones were blocked.
class FakeCheckoutView extends StatefulWidget {
  const new({
    required this.checkoutUrl,
    required this.onResult,
    required this.navigations,
    super.key,
  });

  final Uri checkoutUrl;
  final void Function(String donationId, String? status) onResult;
  final List<String> navigations;

  @override
  State<FakeCheckoutView> createState() => _FakeCheckoutViewState();
}

class _FakeCheckoutViewState extends State<FakeCheckoutView> {
  final List<String> _blocked = [];

  void _run() {
    final policy = CheckoutNavigationPolicy(
      devFlavor: false,
      apiBaseUrl: testEnv.apiBaseUrl,
      onResult: widget.onResult,
    );
    for (final url in widget.navigations) {
      final decision = policy.handle(
        NavigationRequest(url: url, isMainFrame: true),
      );
      if (decision == NavigationDecision.prevent &&
          !url.startsWith('askida:')) {
        setState(() => _blocked.add(url));
      }
    }
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      Text('checkout ${widget.checkoutUrl}'),
      for (final url in _blocked) Text('blocked $url'),
      TextButton(
        key: const ValueKey('fake-checkout-run'),
        onPressed: _run,
        child: const Text('run'),
      ),
    ],
  );
}

/// Every fake the donor-side screens use, wired as provider overrides.
class DonorHarness {
  new({LocationPermissionState afterRequest = LocationPermissionState.granted})
    : location = FakeLocationService(afterRequest: afterRequest);

  final sink = ForwardingSessionSink();
  late final FakeAuthRepository auth = FakeAuthRepository(session: sink);
  final shops = FakeShopsRepository();
  FakeDonationsRepository donations = FakeDonationsRepository();
  final impact = FakeImpactRepository();
  final identity = FakeIdentityProvider();
  final push = FakePushService();
  final pushRepo = FakePushRepository();
  final FakeLocationService location;
  final tiles = FakeTileProvider();
  final settings = InMemorySettingsStore();

  /// Navigations the fake checkout runs (after the pay page loaded).
  List<String> checkoutNavigations = const [];

  /// Use the real allowlisted WebView instead of the fake.
  bool realCheckout = false;

  static SessionState signedIn(User user) =>
      SessionState(user: user, hasUserToken: true, restored: true);

  static SessionState get donorSession =>
      signedIn(FakeAuthRepository.sampleDonor());

  List<Override> get overrides => [
    authRepositoryProvider.overrideWith((ref) {
      sink.target = ref.read(sessionProvider.notifier);
      return auth;
    }),
    remoteShopsRepositoryProvider.overrideWithValue(shops),
    donationsRepositoryProvider.overrideWithValue(donations),
    impactRepositoryProvider.overrideWithValue(impact),
    identityProviderProvider.overrideWithValue(identity),
    pushServiceProvider.overrideWithValue(push),
    pushRepositoryProvider.overrideWithValue(pushRepo),
    locationServiceProvider.overrideWithValue(location),
    tileProviderProvider.overrideWithValue(tiles),
    settingsStoreProvider.overrideWithValue(settings),
    if (!realCheckout)
      checkoutViewBuilderProvider.overrideWithValue(
        ({required checkoutUrl, required onResult, required onBlockedStart}) =>
            FakeCheckoutView(
              checkoutUrl: checkoutUrl,
              onResult: onResult,
              navigations: checkoutNavigations,
            ),
      ),
  ];
}

/// Fails the test when a layout overflow (or any other build error) was
/// reported.
void expectNoLayoutErrors(WidgetTester tester) =>
    expect(tester.takeException(), isNull);

/// Screen sizes and text scales every screen is checked at.
const List<(double, Size?)> layoutCases = [
  (1.0, null),
  (1.3, null),
  (1.0, Size(320, 640)),
  (1.3, Size(320, 640)),
];
