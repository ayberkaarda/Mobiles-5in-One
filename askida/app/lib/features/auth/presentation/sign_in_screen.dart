import 'dart:async';

import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/repositories/auth_repository.dart';
import 'package:askida/design/theme.dart';
import 'package:askida/design/tokens.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/field_errors.dart';
import 'package:askida/features/auth/presentation/provider_sign_in.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// `/auth?from=`: e-mail sign-in, Apple / Google (the identity provider) and
/// the ways to registration and password reset. After a sign-in the user
/// continues to `from` (in-app paths only) or the home of the account.
class SignInScreen extends ConsumerStatefulWidget {
  const new({this.from, super.key});

  final String? from;

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  ApiProblem? _problem;
  String? _note;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _continue(User user) {
    final next = homeAfterSignIn(user, from: widget.from);
    context.go(
      user.emailVerified
          ? next
          : AuthPaths.verifyWith(email: user.email, next: next),
    );
  }

  Future<void> _signIn() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _problem = null;
      _note = null;
    });
    try {
      final session = await ref
          .read(authRepositoryProvider)
          .login(
            AuthRules.normaliseEmail(_email.text),
            _password.text,
            ref.read(deviceNameProvider),
          );
      if (mounted) _continue(session.user);
    } on ApiProblem catch (problem) {
      if (mounted) setState(() => _problem = problem);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _provider(IdentityProviderKind kind) async {
    setState(() {
      _busy = true;
      _problem = null;
      _note = null;
    });
    final result = await signInWithProvider(ref, kind);
    if (!mounted) return;
    setState(() => _busy = false);
    final l10n = context.l10n;
    switch (result) {
      case ProviderSignedIn(:final session):
        _continue(session.user);
      case ProviderSignInCancelled():
        break;
      case ProviderSignInUnavailable():
        setState(() => _note = l10n.authProviderUnavailable);
      case ProviderSignInFailed(:final problem):
        setState(() => _problem = problem);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final c = AskidaColors.of(context);
    final problem = _problem;
    final note = _note;
    return FormScreen(
      title: l10n.authSignInTitle,
      onBack: () => context.go(AppMode.donor.path),
      children: [
        Text(l10n.authSignInLead, style: theme.textTheme.bodyLarge),
        formGap,
        if (problem != null && !explainedInline(problem)) ...[
          ProblemBanner(problem: problem),
          formGap,
        ],
        if (note != null) ...[MessageBanner(message: note), formGap],
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              children: [
                TextFormField(
                  key: const ValueKey('signin-email'),
                  controller: _email,
                  enabled: !_busy,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: l10n.authEmailLabel,
                    errorText: fieldErrorText(l10n, problem, 'email'),
                  ),
                  validator: (v) => AuthRules.isEmail(v ?? '')
                      ? null
                      : l10n.authFieldEmailInvalid,
                ),
                formGap,
                TextFormField(
                  key: const ValueKey('signin-password'),
                  controller: _password,
                  enabled: !_busy,
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  onFieldSubmitted: (_) => unawaited(_signIn()),
                  decoration: InputDecoration(
                    labelText: l10n.authPasswordLabel,
                    errorText: fieldErrorText(l10n, problem, 'password'),
                  ),
                  validator: (v) =>
                      (v ?? '').isEmpty ? l10n.authFieldRequired : null,
                ),
              ],
            ),
          ),
        ),
        formGap,
        BusyButton(
          key: const ValueKey('signin-submit'),
          label: l10n.authSignInAction,
          busy: _busy,
          onPressed: () => unawaited(_signIn()),
        ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: TextButton(
            onPressed: _busy
                ? null
                : () => context.push(
                    AuthPaths.forgotWith(
                      email: AuthRules.isEmail(_email.text)
                          ? AuthRules.normaliseEmail(_email.text)
                          : null,
                    ),
                  ),
            child: Text(l10n.authForgotLink),
          ),
        ),
        formGap,
        Row(
          children: [
            Expanded(child: Divider(color: c.border)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AskidaSpacing.s3),
              child: Text(
                l10n.authOr,
                style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
              ),
            ),
            Expanded(child: Divider(color: c.border)),
          ],
        ),
        formGap,
        ProviderSignInButtons(
          enabled: !_busy,
          onPressed: (kind) => unawaited(_provider(kind)),
        ),
        formGapSmall,
        Text(
          l10n.authProviderConsentNote,
          style: theme.textTheme.bodySmall?.copyWith(color: c.textMuted),
        ),
        const SizedBox(height: AskidaSpacing.s6),
        Text(l10n.authNoAccount, style: theme.textTheme.bodyMedium),
        formGapSmall,
        BusyButton(
          key: const ValueKey('signin-register'),
          label: l10n.authCreateAccountAction,
          tonal: true,
          onPressed: _busy
              ? null
              : () => context.push(AuthPaths.registerWith(from: widget.from)),
        ),
      ],
    );
  }
}
