import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/data/repositories/auth_repository.dart';

import '../helpers/fixtures.dart';

/// [IdentityProvider] answering run-time credentials, or [failure]
/// (for example `IdentityCancelled`).
class FakeIdentityProvider implements IdentityProvider {
  Exception? failure;
  String? name = 'Deniz';
  final List<IdentityProviderKind> calls = [];

  Future<IdentityCredential> _answer(IdentityProviderKind provider) async {
    calls.add(provider);
    final error = failure;
    if (error != null) throw error;
    return IdentityCredential(
      provider: provider,
      idToken: dummyToken(provider.name),
      rawNonce: 'nonce-${dummyToken('n')}',
      name: name,
    );
  }

  @override
  Future<IdentityCredential> signInWithApple() =>
      _answer(IdentityProviderKind.apple);

  @override
  Future<IdentityCredential> signInWithGoogle() =>
      _answer(IdentityProviderKind.google);
}
