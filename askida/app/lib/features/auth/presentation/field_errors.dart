import 'package:askida/data/models/api_problem.dart';
import 'package:askida/l10n/gen/app_localizations.dart';

/// Copy for a server validation code on one form field (`errors[].code`
/// of a `validation.failed` problem), or null when [problem] has none for
/// [field].
String? fieldErrorText(
  AppLocalizations l10n,
  ApiProblem? problem,
  String field,
) {
  if (problem == null || !problem.isValidation) return null;
  final codes = problem.codesFor(field);
  if (codes.isEmpty) return null;
  return switch (codes.first) {
    'required' => l10n.authFieldRequired,
    'email' || 'email_missing' => l10n.authFieldEmailInvalid,
    'unique' => l10n.authFieldEmailTaken,
    'min' => l10n.authFieldPasswordShort,
    'uncompromised' => l10n.authFieldPasswordBreached,
    _ => l10n.authFieldInvalid,
  };
}

/// Field names that have a field next to them on the auth forms; other
/// validation errors are shown in the banner.
const Set<String> authFormFields = {
  'email',
  'password',
  'name',
  'code',
  'kvkk_text_version',
};

/// True when [problem] is fully explained by inline field errors.
bool explainedInline(ApiProblem problem) =>
    problem.isValidation &&
    problem.fieldErrors.isNotEmpty &&
    problem.fieldErrors.every((e) => authFormFields.contains(e.field));
