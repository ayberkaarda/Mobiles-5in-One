import 'package:askida/core/attest/attest_channel.dart';
import 'package:askida/core/attest/attestation_service.dart';
import 'package:askida/core/auth/native_identity_provider.dart';
import 'package:askida/core/env/app_env.dart';
import 'package:askida/core/env/flavor.dart';
import 'package:askida/core/http/api_client.dart';
import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/core/locale/app_locale.dart';
import 'package:askida/core/push/push_service.dart';
import 'package:askida/core/storage/secure_token_store.dart';
import 'package:askida/core/time/clock.dart';
import 'package:askida/data/db/app_database.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/repositories/anon_repository.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/repositories/donations_repository.dart';
import 'package:askida/data/repositories/hooks_repository.dart';
import 'package:askida/data/repositories/impact_repository.dart';
import 'package:askida/data/repositories/impl/cached_shops_repository.dart';
import 'package:askida/data/repositories/impl/dio_anon_repository.dart';
import 'package:askida/data/repositories/impl/dio_auth_repository.dart';
import 'package:askida/data/repositories/impl/dio_donations_repository.dart';
import 'package:askida/data/repositories/impl/dio_hooks_repository.dart';
import 'package:askida/data/repositories/impl/dio_misc_repositories.dart';
import 'package:askida/data/repositories/impl/dio_shops_repository.dart';
import 'package:askida/data/repositories/impl/json_body.dart';
import 'package:askida/data/repositories/payouts_repository.dart';
import 'package:askida/data/repositories/push_repository.dart';
import 'package:askida/data/repositories/shops_repository.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/discovery/data/location_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_map/flutter_map.dart'
    show NetworkTileProvider, TileProvider;
import 'package:flutter_riverpod/flutter_riverpod.dart';

// Every seam the features use has a provider here; tests override them
// (fakes live in test/fakes). Features never construct implementations.

/// Secure storage of the user and anon tokens.
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

/// `android` or `ios`, as the API expects it.
final devicePlatformProvider = Provider<String>(
  (ref) => defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
);

/// The single HTTP client. A 401 `auth.unauthenticated` clears the token and
/// updates the session, which makes the guards send the user to sign-in.
final apiClientProvider = Provider<ApiClient>((ref) {
  final session = ref.read(sessionProvider.notifier);
  return ApiClient(
    baseUrl: ref.watch(appEnvProvider).apiBaseUrl,
    tokens: ref.watch(tokenStoreProvider),
    languageTag: () => ref.read(apiLanguageProvider),
    onUnauthenticated: (scope) => switch (scope) {
      AuthScope.user => session.signedOut(),
      AuthScope.anon => session.anonCleared(),
      AuthScope.none => null,
    },
  );
});

/// The offline cache (tests override with an in-memory database).
final appDatabaseProvider = Provider<AppDatabase>((ref) {
  final db = AppDatabase.open();
  ref.onDispose(db.close);
  return db;
});

/// Wipes the offline database after an account or anon identity is erased.
final localDataEraserProvider = Provider<LocalDataEraser>((ref) {
  final db = ref.watch(appDatabaseProvider);
  return db.clearAll;
});

/// Device attestation for the anon identity (dev flavor fallback inside).
final attestationServiceProvider = Provider<AttestationService>(
  (ref) => ChannelAttestationService(
    channel: ref.watch(attestChannelProvider),
    platform: ref.watch(devicePlatformProvider),
    devFlavor: ref.watch(devFlavorProvider),
  ),
);

final authRepositoryProvider = Provider<AuthRepository>(
  (ref) => DioAuthRepository(
    ref.watch(apiClientProvider),
    platform: ref.watch(devicePlatformProvider),
    session: ref.read(sessionProvider.notifier),
    eraseLocalData: ref.watch(localDataEraserProvider),
  ),
);

final anonRepositoryProvider = Provider<AnonRepository>(
  (ref) => DioAnonRepository(
    ref.watch(apiClientProvider),
    attestation: ref.watch(attestationServiceProvider),
    session: ref.read(sessionProvider.notifier),
    eraseLocalData: ref.watch(localDataEraserProvider),
  ),
);

/// Network-only shops repository; features use [shopsRepositoryProvider].
final remoteShopsRepositoryProvider = Provider<ShopsRepository>(
  (ref) => DioShopsRepository(ref.watch(apiClientProvider)),
);

/// The cache decorator, for screens that want [CachedShopsRepository.
/// watchNearby] (cached list first, then the network list).
final cachedShopsRepositoryProvider = Provider<CachedShopsRepository>(
  (ref) => CachedShopsRepository(
    ref.watch(remoteShopsRepositoryProvider),
    ref.watch(appDatabaseProvider),
    clock: ref.watch(clockProvider),
  ),
);

/// What features use for shops: read-through cached (24 h TTL).
final shopsRepositoryProvider = Provider<ShopsRepository>(
  (ref) => ref.watch(cachedShopsRepositoryProvider),
);

final hooksRepositoryProvider = Provider<HooksRepository>(
  (ref) => DioHooksRepository(ref.watch(apiClientProvider)),
);

final donationsRepositoryProvider = Provider<DonationsRepository>(
  (ref) => DioDonationsRepository(ref.watch(apiClientProvider)),
);

final payoutsRepositoryProvider = Provider<PayoutsRepository>(
  (ref) => DioPayoutsRepository(ref.watch(apiClientProvider)),
);

final impactRepositoryProvider = Provider<ImpactRepository>(
  (ref) => DioImpactRepository(ref.watch(apiClientProvider)),
);

final pushRepositoryProvider = Provider<PushRepository>(
  (ref) => DioPushRepository(ref.watch(apiClientProvider)),
);

/// Push transport; Noop until a Firebase configuration exists (ADR-0004).
final pushServiceProvider = Provider<PushService>(
  (ref) => const NoopPushService(),
);

/// Apple / Google sign-in over the native SDKs. No Google server client id
/// ships, so Google reports IdentityUnavailable; Apple works where the
/// platform supports it (iOS), otherwise the same.
final identityProviderProvider = Provider<IdentityProvider>(
  (ref) => const NativeIdentityProvider(),
);

/// Map tiles (tests override with a fake provider; no network in tests).
final tileProviderProvider = Provider<TileProvider>(
  (ref) => NetworkTileProvider(),
);

/// Device location (tests override with a fake).
final locationServiceProvider = Provider<LocationService>(
  (ref) => const GeolocatorLocationService(),
);

/// Reads the secure store at launch and loads the account when a user
/// token exists. Offline, the token is kept and the user stays unknown.
final sessionRestoreProvider = FutureProvider<void>((ref) async {
  final tokens = ref.read(tokenStoreProvider);
  final hasAnon = await tokens.readAnon() != null;
  User? user;
  if (await tokens.readUser() != null) {
    try {
      user = await ref.read(authRepositoryProvider).me();
    } on ApiProblem {
      user = null;
    }
  }
  ref
      .read(sessionProvider.notifier)
      .restored(
        hasUserToken: await tokens.readUser() != null,
        hasAnonToken: hasAnon,
        user: user,
      );
});
