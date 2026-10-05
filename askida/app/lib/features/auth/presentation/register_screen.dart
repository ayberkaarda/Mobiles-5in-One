import 'dart:async';

import 'package:askida/data/models/api_problem.dart';
import 'package:askida/data/models/user.dart';
import 'package:askida/data/providers.dart';
import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/field_errors.dart';
import 'package:askida/features/auth/presentation/widgets/form_parts.dart';
import 'package:askida/l10n/l10n.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

/// `/auth/register?kind=&from=`: name, e-mail, password, account kind
/// (donor or merchant) and the KVKK consent. A new account continues to the
/// e-mail verification.
class RegisterScreen extends ConsumerStatefulWidget {
  const new({this.from, this.kind = UserKind.donor, super.key});

  final String? from;
  final UserKind kind;

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  late UserKind _kind = widget.kind;
  bool _consent = false;
  bool _consentMissing = false;
  bool _busy = false;
  ApiProblem? _problem;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _register() async {
    final valid = _form.currentState?.validate() ?? false;
    setState(() => _consentMissing = !_consent);
    if (!valid || !_consent) return;
    setState(() {
      _busy = true;
      _problem = null;
    });
    try {
      final session = await ref
          .read(authRepositoryProvider)
          .register(
            email: AuthRules.normaliseEmail(_email.text),
            password: _password.text,
            name: _name.text.trim(),
            kind: _kind,
            deviceName: ref.read(deviceNameProvider),
            kvkkTextVersion: AuthRules.kvkkTextVersion,
          );
      if (!mounted) return;
      final next = homeAfterSignIn(session.user, from: widget.from);
      context.go(AuthPaths.verifyWith(email: session.user.email, next: next));
    } on ApiProblem catch (problem) {
      if (mounted) setState(() => _problem = problem);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final theme = Theme.of(context);
    final problem = _problem;
    return FormScreen(
      title: l10n.authRegisterTitle,
      onBack: () => context.canPop()
          ? context.pop()
          : context.go(AuthPaths.signIn(from: widget.from)),
      children: [
        Text(l10n.authRegisterLead, style: theme.textTheme.bodyLarge),
        formGap,
        if (problem != null && !explainedInline(problem)) ...[
          ProblemBanner(problem: problem),
          formGap,
        ],
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextFormField(
                  key: const ValueKey('register-name'),
                  controller: _name,
                  enabled: !_busy,
                  maxLength: AuthRules.nameMax,
                  autofillHints: const [AutofillHints.name],
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: l10n.authNameLabel,
                    helperText: l10n.authNameHelper,
                    counterText: '',
                    errorText: fieldErrorText(l10n, problem, 'name'),
                  ),
                  validator: (v) =>
                      (v ?? '').trim().isEmpty ? l10n.authFieldRequired : null,
                ),
                formGap,
                TextFormField(
                  key: const ValueKey('register-email'),
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
                  key: const ValueKey('register-password'),
                  controller: _password,
                  enabled: !_busy,
                  obscureText: true,
                  autofillHints: const [AutofillHints.newPassword],
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(
                    labelText: l10n.authPasswordLabel,
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
        ),
        formGap,
        Text(l10n.authKindTitle, style: theme.textTheme.titleMedium),
        formGapSmall,
        RadioGroup<UserKind>(
          groupValue: _kind,
          onChanged: (kind) {
            if (kind != null && !_busy) setState(() => _kind = kind);
          },
          child: Column(
            children: [
              RadioListTile<UserKind>(
                key: const ValueKey('register-kind-donor'),
                value: UserKind.donor,
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.authKindDonor),
                subtitle: Text(l10n.authKindDonorBody),
              ),
              RadioListTile<UserKind>(
                key: const ValueKey('register-kind-merchant'),
                value: UserKind.merchant,
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.authKindMerchant),
                subtitle: Text(l10n.authKindMerchantBody),
              ),
            ],
          ),
        ),
        formGapSmall,
        CheckboxListTile(
          key: const ValueKey('register-consent'),
          value: _consent,
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          onChanged: _busy
              ? null
              : (value) => setState(() {
                  _consent = value ?? false;
                  if (_consent) _consentMissing = false;
                }),
          title: Text(l10n.authKvkkConsent),
          subtitle:
              _consentMissing ||
                  fieldErrorText(l10n, problem, 'kvkk_text_version') != null
              ? Text(
                  l10n.authKvkkRequired,
                  style: TextStyle(color: theme.colorScheme.error),
                )
              : null,
        ),
        formGap,
        BusyButton(
          key: const ValueKey('register-submit'),
          label: l10n.authRegisterAction,
          busy: _busy,
          onPressed: () => unawaited(_register()),
        ),
        formGapSmall,
        Center(
          child: TextButton(
            onPressed: _busy
                ? null
                : () => context.go(AuthPaths.signIn(from: widget.from)),
            child: Text(l10n.authHaveAccount),
          ),
        ),
      ],
    );
  }
}

/// Parses `?kind=` (anything else is a donor account).
UserKind registerKindFrom(String? value) =>
    value == UserKind.merchant.name ? UserKind.merchant : UserKind.donor;
