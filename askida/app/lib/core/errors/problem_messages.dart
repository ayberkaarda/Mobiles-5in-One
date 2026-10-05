import 'package:askida/data/models/api_problem.dart';
import 'package:askida/l10n/gen/app_localizations.dart';

/// Every problem `code` the server can send (ADR-0010 catalogue plus the
/// append-only domain codes) and the device-side transport codes, mapped to
/// the ARB key of its user copy. Unknown codes use [genericProblemKey].
const Map<String, String> problemMessageKeys = {
  'validation.failed': 'problemValidationFailed',
  'auth.invalid_credentials': 'problemAuthInvalidCredentials',
  'auth.locked': 'problemAuthLocked',
  'auth.unauthenticated': 'problemAuthUnauthenticated',
  'auth.email_unverified': 'problemAuthEmailUnverified',
  'auth.token_invalid': 'problemAuthTokenInvalid',
  'forbidden': 'problemForbidden',
  'not_found': 'problemNotFound',
  'conflict': 'problemConflict',
  'rate_limited': 'problemRateLimited',
  'payload_too_large': 'problemPayloadTooLarge',
  'unsupported_media_type': 'problemUnsupportedMediaType',
  'server_error': 'problemServerError',
  'bad_request': 'problemBadRequest',
  'method_not_allowed': 'problemMethodNotAllowed',
  'https_required': 'problemHttpsRequired',
  'service_unavailable': 'problemServiceUnavailable',
  'shop.has_open_hooks': 'problemShopHasOpenHooks',
  'shop.not_verified': 'problemShopNotVerified',
  'shop.not_payable': 'problemShopNotPayable',
  'anon.daily_cap': 'problemAnonDailyCap',
  'anon.shop_cap': 'problemAnonShopCap',
  'hook.none_available': 'problemHookNoneAvailable',
  'hook.code_invalid': 'problemHookCodeInvalid',
  'hook.code_expired': 'problemHookCodeExpired',
  'hook.wrong_shop': 'problemHookWrongShop',
  'donation.cap_exceeded': 'problemDonationCapExceeded',
  'donation.tx_cap_exceeded': 'problemDonationTxCapExceeded',
  'payment.mismatch': 'problemPaymentMismatch',
  ApiProblem.networkOffline: 'problemNetworkOffline',
  ApiProblem.networkTimeout: 'problemNetworkTimeout',
  ApiProblem.badResponse: 'problemBadResponse',
  ApiProblem.cancelled: 'problemCancelled',
};

const String genericProblemKey = 'problemGeneric';

/// ARB key for [code].
String problemMessageKey(String code) =>
    problemMessageKeys[code] ?? genericProblemKey;

/// User copy for [code]. Server `title` text is never shown.
String problemMessage(AppLocalizations l10n, String code) =>
    switch (problemMessageKey(code)) {
      'problemValidationFailed' => l10n.problemValidationFailed,
      'problemAuthInvalidCredentials' => l10n.problemAuthInvalidCredentials,
      'problemAuthLocked' => l10n.problemAuthLocked,
      'problemAuthUnauthenticated' => l10n.problemAuthUnauthenticated,
      'problemAuthEmailUnverified' => l10n.problemAuthEmailUnverified,
      'problemAuthTokenInvalid' => l10n.problemAuthTokenInvalid,
      'problemForbidden' => l10n.problemForbidden,
      'problemNotFound' => l10n.problemNotFound,
      'problemConflict' => l10n.problemConflict,
      'problemRateLimited' => l10n.problemRateLimited,
      'problemPayloadTooLarge' => l10n.problemPayloadTooLarge,
      'problemUnsupportedMediaType' => l10n.problemUnsupportedMediaType,
      'problemServerError' => l10n.problemServerError,
      'problemBadRequest' => l10n.problemBadRequest,
      'problemMethodNotAllowed' => l10n.problemMethodNotAllowed,
      'problemHttpsRequired' => l10n.problemHttpsRequired,
      'problemServiceUnavailable' => l10n.problemServiceUnavailable,
      'problemShopHasOpenHooks' => l10n.problemShopHasOpenHooks,
      'problemShopNotVerified' => l10n.problemShopNotVerified,
      'problemShopNotPayable' => l10n.problemShopNotPayable,
      'problemAnonDailyCap' => l10n.problemAnonDailyCap,
      'problemAnonShopCap' => l10n.problemAnonShopCap,
      'problemHookNoneAvailable' => l10n.problemHookNoneAvailable,
      'problemHookCodeInvalid' => l10n.problemHookCodeInvalid,
      'problemHookCodeExpired' => l10n.problemHookCodeExpired,
      'problemHookWrongShop' => l10n.problemHookWrongShop,
      'problemDonationCapExceeded' => l10n.problemDonationCapExceeded,
      'problemDonationTxCapExceeded' => l10n.problemDonationTxCapExceeded,
      'problemPaymentMismatch' => l10n.problemPaymentMismatch,
      'problemNetworkOffline' => l10n.problemNetworkOffline,
      'problemNetworkTimeout' => l10n.problemNetworkTimeout,
      'problemBadResponse' => l10n.problemBadResponse,
      'problemCancelled' => l10n.problemCancelled,
      _ => l10n.problemGeneric,
    };

extension ApiProblemMessage on ApiProblem {
  /// User copy for this problem.
  String message(AppLocalizations l10n) => problemMessage(l10n, code);
}
