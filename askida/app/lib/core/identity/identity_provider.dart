import 'package:askida/data/repositories/auth_repository.dart';
import 'package:flutter/foundation.dart';

/// What a provider sign-in hands to `AuthRepository.loginWithApple/Google`
/// (and to the `DELETE me` re-authentication).
@immutable
class IdentityCredential {
  const new({
    required this.provider,
    required this.idToken,
    required this.rawNonce,
    this.name,
  });

  final IdentityProviderKind provider;

  /// Provider identity token; never logged or stored.
  final String idToken;

  /// The raw nonce sent with the request (the server compares the hash for
  /// Apple and the raw value for Google).
  final String rawNonce;

  /// Name, when the provider shares it (Apple: first sign-in only).
  final String? name;
}

/// The user closed the provider sheet; not an error to show.
class IdentityCancelled implements Exception {
  const new();
}

/// No provider is configured in this build.
class IdentityUnavailable implements Exception {
  const new(this.provider);

  final IdentityProviderKind provider;

  @override
  String toString() => 'IdentityUnavailable(${provider.name})';
}

/// Apple / Google sign-in behind an interface. Real sign-in needs provider
/// accounts and client ids and is not exercised here.
abstract interface class IdentityProvider {
  Future<IdentityCredential> signInWithApple();
  Future<IdentityCredential> signInWithGoogle();
}

/// Default until a provider is configured: both buttons report
/// [IdentityUnavailable], so the screens can hide or explain them.
class UnconfiguredIdentityProvider implements IdentityProvider {
  const new();

  @override
  Future<IdentityCredential> signInWithApple() =>
      Future.error(const IdentityUnavailable(IdentityProviderKind.apple));

  @override
  Future<IdentityCredential> signInWithGoogle() =>
      Future.error(const IdentityUnavailable(IdentityProviderKind.google));
}
