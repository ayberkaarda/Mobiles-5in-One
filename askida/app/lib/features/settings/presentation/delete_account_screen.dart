import 'dart:async';

import 'package:askida/core/identity/identity_provider.dart';
import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/auth_session.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/data/session.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/provider_sign_in.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/features/settings/presentation/settings_screen.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

/// `/settings/delete-account`: account deletion with re-authentication
/// (the password, or a fresh Apple / Google sign-in for accounts without
/// one). The server deactivates the account at once and erases it after
/// the grace period; this device forgets the token and the offline data.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const new({super.key});

  @override
  ConsumerState<DeleteAccountScreen> createState() =>
      _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  bool _busy = false;
  ApiProblem? _problem;
  String? _note;
  DeletionPending? _done;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<bool> _confirm() async {
    final l10n = context.l10n;
    final c = AskidaColors.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.deleteConfirmTitle),
        content: Text(l10n.deleteConfirmBody),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text(l10n.deleteConfirmCancel),
          ),
          TextButton(
            key: const ValueKey('delete-confirm'),
            style: TextButton.styleFrom(foregroundColor: c.dangerText),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(l10n.deleteConfirmAction),
          ),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _delete(Reauth reauth) async {
    setState(() {
      _busy = true;
      _problem = null;
      _note = null;
    });
    try {
      final pending = await ref.read(authRepositoryProvider).deleteMe(reauth);
      if (mounted) setState(() => _done = pending);
    } on ApiProblem catch (problem) {
      if (mounted) setState(() => _problem = problem);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withPassword() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    if (!await _confirm()) return;
    await _delete(PasswordReauth(_password.text));
  }

  Future<void> _withProvider(IdentityProviderKind kind) async {
    if (!await _confirm()) return;
    final identity = ref.read(identityProviderProvider);
    final IdentityCredential credential;
    try {
      credential = switch (kind) {
        IdentityProviderKind.apple => await identity.signInWithApple(),
        IdentityProviderKind.google => await identity.signInWithGoogle(),
      };
    } on IdentityCancelled {
      return;
    } on IdentityUnavailable {
      if (mounted) {
        setState(() => _note = context.l10n.authProviderUnavailable);
      }
      return;
    }
    await _delete(
      ProviderReauth(
        provider: kind,
        idToken: credential.idToken,
        nonce: credential.rawNonce,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final done = _done;
    if (done != null) {
      final until = DateFormat.yMMMMd(l10n.localeName)
          .format(done.graceUntil.toLocal());
      return FormScreen(
        title: l10n.deleteTitle,
        onBack: () => context.go(AppMode.donor.path),
        children: [
          MessageBanner(
            key: const ValueKey('delete-done'),
            message: l10n.deleteDone(until),
          ),
          formGap,
          BusyButton(
            label: l10n.deleteDoneAction,
            onPressed: () => context.go(AppMode.donor.path),
          ),
        ],
      );
    }
    if (!ref.watch(sessionProvider.select((s) => s.isSignedIn))) {
      return FormScreen(
        title: l10n.deleteTitle,
        onBack: () => context.go(AppMode.donor.path),
        children: [
          MessageBanner(message: l10n.deleteSignInFirst),
          formGap,
          BusyButton(
            key: const ValueKey('delete-signin'),
            label: l10n.authSignInAction,
            onPressed: () =>
                context.go(AuthPaths.signIn(from: SettingsPaths.deleteAccount)),
          ),
        ],
      );
    }
    final problem = _problem;
    final note = _note;
    return FormScreen(
      title: l10n.deleteTitle,
      onBack: () =>
          context.canPop() ? context.pop() : context.go(AppMode.donor.path),
      children: [
        Text(l10n.deleteLead, style: theme.textTheme.bodyLarge),
        formGap,
        if (problem != null) ...[ProblemBanner(problem: problem), formGap],
        if (note != null) ...[MessageBanner(message: note), formGap],
        Form(
          key: _form,
          child: TextFormField(
            key: const ValueKey('delete-password'),
            controller: _password,
            enabled: !_busy,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: InputDecoration(labelText: l10n.authPasswordLabel),
            validator: (v) => (v ?? '').isEmpty ? l10n.authFieldRequired : null,
          ),
        ),
        formGap,
        BusyButton(
          key: const ValueKey('delete-submit'),
          label: l10n.deleteAction,
          danger: true,
          busy: _busy,
          onPressed: () => unawaited(_withPassword()),
        ),
        formGap,
        Text(l10n.deleteProviderLead, style: theme.textTheme.bodyMedium),
        formGapSmall,
        ProviderSignInButtons(
          enabled: !_busy,
          onPressed: (kind) => unawaited(_withProvider(kind)),
        ),
      ],
    );
  }
}
