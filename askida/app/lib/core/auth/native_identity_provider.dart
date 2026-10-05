import 'dart:convert';

import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:crypto/crypto.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';

/// What the Apple SDK returned that the app uses.
typedef AppleCredential = ({String? identityToken, String? givenName});

/// What the Google SDK returned that the app uses.
typedef GoogleCredential = ({String? idToken, String? displayName});

/// Thin seam over `sign_in_with_apple` (static API).
abstract interface class AppleSignInClient {
  Future<bool> isAvailable();

  /// [hashedNonce] is embedded in the identity token; the server compares
  /// it with sha256 of the raw nonce.
  Future<AppleCredential> credential({required String hashedNonce});
}

/// Thin seam over `google_sign_in` 7 (singleton API).
abstract interface class GoogleSignInClient {
  Future<GoogleCredential> authenticate({
    required String serverClientId,
    required String nonce,
  });
}

class SdkAppleSignInClient implements AppleSignInClient {
  const new();

  @override
  Future<bool> isAvailable() => SignInWithApple.isAvailable();

  @override
  Future<AppleCredential> credential({required String hashedNonce}) async {
    final result = await SignInWithApple.getAppleIDCredential(
      scopes: const [AppleIDAuthorizationScopes.fullName],
      nonce: hashedNonce,
    );
    return (identityToken: result.identityToken, givenName: result.givenName);
  }
}

class SdkGoogleSignInClient implements GoogleSignInClient {
  const new();

  @override
  Future<GoogleCredential> authenticate({
    required String serverClientId,
    required String nonce,
  }) async {
    final google = GoogleSignIn.instance;
    await google.initialize(serverClientId: serverClientId, nonce: nonce);
    final account = await google.authenticate();
    return (
      idToken: account.authentication.idToken,
      displayName: account.displayName,
    );
  }
}

/// [IdentityProvider] over the native SDKs.
///
/// Guarded: an SDK that is missing, unsupported on this platform, not
/// configured (no Google server client id; Apple on Android needs web
/// options that this app does not ship) or failing ends in
/// [IdentityUnavailable]; a closed sheet ends in [IdentityCancelled]. It
/// never crashes. Real sign-in needs provider accounts and is not
/// exercised here.
class NativeIdentityProvider implements IdentityProvider {
  const new({
    this.googleServerClientId,
    this._apple = const SdkAppleSignInClient(),
    this._google = const SdkGoogleSignInClient(),
    this._rawNonce = generateNonce,
  });

  /// OAuth server client id for the ID token audience; null means Google
  /// sign-in is not configured in this build.
  final String? googleServerClientId;
  final AppleSignInClient _apple;
  final GoogleSignInClient _google;
  final String Function() _rawNonce;

  static String sha256Hex(String value) =>
      sha256.convert(utf8.encode(value)).toString();

  @override
  Future<IdentityCredential> signInWithApple() async {
    const kind = IdentityProviderKind.apple;
    final raw = _rawNonce();
    final AppleCredential result;
    try {
      if (!await _apple.isAvailable()) throw const IdentityUnavailable(kind);
      result = await _apple.credential(hashedNonce: sha256Hex(raw));
    } on IdentityUnavailable {
      rethrow;
    } on SignInWithAppleAuthorizationException catch (error) {
      if (error.code == AuthorizationErrorCode.canceled) {
        throw const IdentityCancelled();
      }
      throw const IdentityUnavailable(kind);
    } on Object {
      throw const IdentityUnavailable(kind);
    }
    final token = result.identityToken;
    if (token == null || token.isEmpty) throw const IdentityUnavailable(kind);
    return IdentityCredential(
      provider: kind,
      idToken: token,
      rawNonce: raw,
      name: result.givenName,
    );
  }

  @override
  Future<IdentityCredential> signInWithGoogle() async {
    const kind = IdentityProviderKind.google;
    final clientId = googleServerClientId;
    if (clientId == null || clientId.isEmpty) {
      throw const IdentityUnavailable(kind);
    }
    final raw = _rawNonce();
    final GoogleCredential result;
    try {
      result = await _google.authenticate(serverClientId: clientId, nonce: raw);
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled) {
        throw const IdentityCancelled();
      }
      throw const IdentityUnavailable(kind);
    } on Object {
      throw const IdentityUnavailable(kind);
    }
    final token = result.idToken;
    if (token == null || token.isEmpty) throw const IdentityUnavailable(kind);
    return IdentityCredential(
      provider: kind,
      idToken: token,
      rawNonce: raw,
      name: result.displayName,
    );
  }
}
