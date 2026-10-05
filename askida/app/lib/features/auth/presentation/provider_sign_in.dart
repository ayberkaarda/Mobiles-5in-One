import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Outcome of a provider sign-in attempt.
sealed class ProviderSignInResult {
  const new();
}

final class ProviderSignedIn extends ProviderSignInResult {
  const new(this.session);

  final AuthSession session;
}

/// The user closed the provider sheet: nothing to show.
final class ProviderSignInCancelled extends ProviderSignInResult {
  const new();
}

/// The provider is not configured or not supported in this build.
final class ProviderSignInUnavailable extends ProviderSignInResult {
  const new(this.provider);

  final IdentityProviderKind provider;
}

final class ProviderSignInFailed extends ProviderSignInResult {
  const new(this.problem);

  final ApiProblem problem;
}

/// Runs the platform sheet through [IdentityProvider], then signs in with
/// the server. [kind] is used only when the server creates the account; the
/// KVKK version travels with it because creating an account records the
/// consent (the screen shows the notice next to the buttons).
Future<ProviderSignInResult> signInWithProvider(
  WidgetRef ref,
  IdentityProviderKind provider, {
  UserKind kind = UserKind.donor,
}) async {
  final identity = ref.read(identityProviderProvider);
  final IdentityCredential credential;
  try {
    credential = switch (provider) {
      IdentityProviderKind.apple => await identity.signInWithApple(),
      IdentityProviderKind.google => await identity.signInWithGoogle(),
    };
  } on IdentityCancelled {
    return const ProviderSignInCancelled();
  } on IdentityUnavailable {
    return ProviderSignInUnavailable(provider);
  }
  final auth = ref.read(authRepositoryProvider);
  final device = ref.read(deviceNameProvider);
  try {
    final session = switch (provider) {
      IdentityProviderKind.apple => await auth.loginWithApple(
        idToken: credential.idToken,
        nonce: credential.rawNonce,
        deviceName: device,
        name: credential.name,
        kind: kind,
        kvkkTextVersion: AuthRules.kvkkTextVersion,
      ),
      IdentityProviderKind.google => await auth.loginWithGoogle(
        idToken: credential.idToken,
        nonce: credential.rawNonce,
        deviceName: device,
        name: credential.name,
        kind: kind,
        kvkkTextVersion: AuthRules.kvkkTextVersion,
      ),
    };
    return ProviderSignedIn(session);
  } on ApiProblem catch (problem) {
    return ProviderSignInFailed(problem);
  }
}

/// "Apple ile devam et" and "Google ile devam et" as tonal buttons.
class ProviderSignInButtons extends StatelessWidget {
  const new({required this.onPressed, this.enabled = true, super.key});

  final ValueChanged<IdentityProviderKind> onPressed;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    Widget button(IdentityProviderKind kind, IconData icon, String label) =>
        SizedBox(
          width: double.infinity,
          child: FilledButton.tonalIcon(
            key: ValueKey('provider-${kind.name}'),
            onPressed: enabled ? () => onPressed(kind) : null,
            icon: Icon(icon, size: 20),
            label: Text(label, textAlign: TextAlign.center),
          ),
        );
    return Column(
      children: [
        button(
          IdentityProviderKind.apple,
          Icons.apple,
          l10n.authContinueWithApple,
        ),
        const SizedBox(height: AskidaSpacing.s2),
        button(
          IdentityProviderKind.google,
          Icons.account_circle_outlined,
          l10n.authContinueWithGoogle,
        ),
      ],
    );
  }
}
