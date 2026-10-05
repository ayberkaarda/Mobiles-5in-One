import 'dart:async';

import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/data/session.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/field_errors.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:askida/routing/app_mode.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// The 6-digit code field of the verification and reset screens.
class CodeField extends StatelessWidget {
  const new({
    required this.controller,
    this.enabled = true,
    this.errorText,
    super.key,
  });

  final TextEditingController controller;
  final bool enabled;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return TextFormField(
      key: const ValueKey('code-field'),
      controller: controller,
      enabled: enabled,
      keyboardType: TextInputType.number,
      autofillHints: const [AutofillHints.oneTimeCode],
      maxLength: AuthRules.codeLength,
      inputFormatters: [FilteringTextInputFormatter.digitsOnly],
      decoration: InputDecoration(
        labelText: l10n.authCodeLabel,
        helperText: l10n.authCodeHelper,
        counterText: '',
        errorText: errorText,
      ),
      validator: (v) => AuthRules.isCode(v ?? '') ? null : l10n.authCodeInvalid,
    );
  }
}

/// `/auth/forgot?email=`: asks for a reset code. The server always accepts
/// (it never says whether an account exists), so the screen moves on to the
/// code entry either way.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const new({this.email, super.key});

  final String? email;

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  late final _email = TextEditingController(text: widget.email ?? '');
  bool _busy = false;
  ApiProblem? _problem;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    final email = AuthRules.normaliseEmail(_email.text);
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      await ref.read(authRepositoryProvider).forgot(email);
      if (mounted) context.go(AuthPaths.resetWith(email: email));
    } on ApiProblem catch (problem) {
      if (mounted) setState(() => _problem = problem);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final problem = _problem;
    return FormScreen(
      title: l10n.authForgotTitle,
      onBack: () =>
          context.canPop() ? context.pop() : context.go(AuthPaths.signIn()),
      children: [
        Text(l10n.authForgotLead, style: Theme.of(context).textTheme.bodyLarge),
        formGap,
        if (problem != null && !explainedInline(problem)) ...[
          ProblemBanner(problem: problem),
          formGap,
        ],
        Form(
          key: _form,
          child: TextFormField(
            key: const ValueKey('forgot-email'),
            controller: _email,
            enabled: !_busy,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: InputDecoration(
              labelText: l10n.authEmailLabel,
              errorText: fieldErrorText(l10n, problem, 'email'),
            ),
            validator: (v) =>
                AuthRules.isEmail(v ?? '') ? null : l10n.authFieldEmailInvalid,
          ),
        ),
        formGap,
        BusyButton(
          key: const ValueKey('forgot-submit'),
          label: l10n.authForgotAction,
          busy: _busy,
          onPressed: () => unawaited(_send()),
        ),
      ],
    );
  }
}

/// `/auth/reset?email=`: the mailed code and a new password. Every session
/// of the account ends on the server, so the user signs in again.
class ResetPasswordScreen extends ConsumerStatefulWidget {
  const new({required this.email, super.key});

  final String email;

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  bool _done = false;
  ApiProblem? _problem;

  @override
  void dispose() {
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _reset() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .reset(_code.text.trim(), _password.text, email: widget.email);
      if (mounted) setState(() => _done = true);
    } on ApiProblem catch (problem) {
      if (mounted) setState(() => _problem = problem);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final problem = _problem;
    if (_done) {
      return FormScreen(
        title: l10n.authResetTitle,
        onBack: () => context.go(AuthPaths.signIn()),
        children: [
          MessageBanner(message: l10n.authResetDone),
          formGap,
          BusyButton(
            key: const ValueKey('reset-signin'),
            label: l10n.authSignInAction,
            onPressed: () => context.go(AuthPaths.signIn()),
          ),
        ],
      );
    }
    return FormScreen(
      title: l10n.authResetTitle,
      onBack: () => context.go(AuthPaths.signIn()),
      children: [
        Text(
          l10n.authResetLead(widget.email),
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        formGap,
        if (problem != null && !explainedInline(problem)) ...[
          ProblemBanner(problem: problem),
          formGap,
        ],
        Form(
          key: _form,
          child: Column(
            children: [
              CodeField(
                controller: _code,
                enabled: !_busy,
                errorText: fieldErrorText(l10n, problem, 'code'),
              ),
              formGap,
              TextFormField(
                key: const ValueKey('reset-password'),
                controller: _password,
                enabled: !_busy,
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                decoration: InputDecoration(
                  labelText: l10n.authNewPasswordLabel,
                  helperText: l10n.authPasswordHelper(AuthRules.passwordMin),
                  helperMaxLines: 2,
                  errorText: fieldErrorText(l10n, problem, 'password'),
                ),
                validator: (v) => AuthRules.isPassword(v ?? '')
                    ? null
                    : l10n.authFieldPasswordShort,
              ),
            ],
          ),
        ),
        formGap,
        BusyButton(
          key: const ValueKey('reset-submit'),
          label: l10n.authResetAction,
          busy: _busy,
          onPressed: () => unawaited(_reset()),
        ),
      ],
    );
  }
}

/// `/auth/verify?email=&next=`: the 6-digit code from the verification
/// mail. Verifying can wait ("Şimdilik geç"); the server asks for it where
/// it is required (`auth.email_unverified`).
class VerifyEmailScreen extends ConsumerStatefulWidget {
  const new({required this.email, this.next, super.key});

  final String email;
  final String? next;

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  bool _busy = false;
  ApiProblem? _problem;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  String get _next {
    final next = safeReturnLocation(widget.next);
    if (next != null) return next;
    final user = ref.read(sessionProvider).user;
    return user == null ? AppMode.donor.path : homeAfterSignIn(user);
  }

  Future<void> _verify() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .verifyEmail(_code.text.trim(), email: widget.email);
      if (!mounted) return;
      ScaffoldMessenger.maybeOf(context)
          ?.showSnackBar(SnackBar(content: Text(context.l10n.authVerifyDone)));
      context.go(_next);
    } on ApiProblem catch (problem) {
      if (mounted) setState(() => _problem = problem);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final problem = _problem;
    return FormScreen(
      title: l10n.authVerifyTitle,
      onBack: () => context.go(_next),
      children: [
        Text(
          l10n.authVerifyLead(widget.email),
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        formGap,
        if (problem != null && !explainedInline(problem)) ...[
          ProblemBanner(problem: problem),
          formGap,
        ],
        Form(
          key: _form,
          child: CodeField(
            controller: _code,
            enabled: !_busy,
            errorText: fieldErrorText(l10n, problem, 'code'),
          ),
        ),
        formGap,
        BusyButton(
          key: const ValueKey('verify-submit'),
          label: l10n.authVerifyAction,
          busy: _busy,
          onPressed: () => unawaited(_verify()),
        ),
        formGapSmall,
        Center(
          child: TextButton(
            key: const ValueKey('verify-later'),
            onPressed: _busy ? null : () => context.go(_next),
            child: Text(l10n.authVerifyLater),
          ),
        ),
      ],
    );
  }
}
