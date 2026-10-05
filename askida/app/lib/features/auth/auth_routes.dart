import 'package:askida/features/auth/domain/auth_rules.dart';
import 'package:askida/features/auth/presentation/recovery_screens.dart';
import 'package:askida/features/auth/presentation/register_screen.dart';
import 'package:askida/features/auth/presentation/sign_in_screen.dart';
import 'package:askida/routing/app_paths.dart';
import 'package:go_router/go_router.dart';

/// Top-level auth routes: `/auth?from=` (sign-in, where the guards send
/// signed-out users), `/auth/register`, `/auth/forgot`, `/auth/reset` and
/// `/auth/verify`. Screens that need an e-mail fall back to the sign-in or
/// the reset request when it is missing.
final List<RouteBase> authRoutes = <RouteBase>[
  GoRoute(
    path: AppPaths.auth,
    builder: (context, state) =>
        SignInScreen(from: state.uri.queryParameters['from']),
    routes: [
      GoRoute(
        path: 'register',
        builder: (context, state) => RegisterScreen(
          from: state.uri.queryParameters['from'],
          kind: registerKindFrom(state.uri.queryParameters['kind']),
        ),
      ),
      GoRoute(
        path: 'forgot',
        builder: (context, state) =>
            ForgotPasswordScreen(email: state.uri.queryParameters['email']),
      ),
      GoRoute(
        path: 'reset',
        redirect: (context, state) =>
            _email(state) == null ? AuthPaths.forgot : null,
        builder: (context, state) => ResetPasswordScreen(email: _email(state)!),
      ),
      GoRoute(
        path: 'verify',
        redirect: (context, state) =>
            _email(state) == null ? AppPaths.auth : null,
        builder: (context, state) => VerifyEmailScreen(
          email: _email(state)!,
          next: state.uri.queryParameters['next'],
        ),
      ),
    ],
  ),
];

String? _email(GoRouterState state) {
  final email = state.uri.queryParameters['email'];
  return email != null && AuthRules.isEmail(email) ? email : null;
}
