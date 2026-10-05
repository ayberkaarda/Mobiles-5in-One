# ADR-0035: Secure storage and token handling in the app

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The server issues bearer tokens to donor and merchant accounts and to anonymous recipient devices
(ADR-0008, ADR-0019). The app must keep them where other apps cannot read them, keep the two identities
apart, and remove them whenever the person leaves.

## Decision

- Both tokens live in `flutter_secure_storage` (`SecureTokenStore`), under separate keys: the user token
  and the anon token are different identities and never replace each other. Tokens are not kept in
  SharedPreferences, in logs, in crash output or in the drift database.
- flutter_secure_storage 11 no longer has the `encryptedSharedPreferences` option. Its Android default
  is AES-GCM with a key wrapped by the Android Keystore, used with a storage namespace; iOS items use
  `first_unlock_this_device` (they do not move to another device through a backup).
- `logout` clears the user token even when the server call fails. Account deletion clears the user token
  and the local database but not the anon token (a separate identity); anonymous deletion wipes the
  anon token and the database even on failure.
- A `401 auth.unauthenticated` clears the token of the scope that was sent (ADR-0034) and routes through
  the sign-in guard.
- Settings (language, theme) are kept through `SettingsStore` in the same secure storage under its own
  namespace; they hold no personal data.
- Test tokens are dummies built at run time (`dummyToken`); fixtures for token responses carry no
  token.
- Sign-in with Apple or Google goes through an `IdentityProvider` interface; its token and nonce are
  sent to the server, and cancel is silent while unavailable is explained.

## Consequences

- On iOS the items use `first_unlock_this_device`, so they are not restored onto another device from a backup; signing in again is required there.
- Because one device may hold an account token and an anon token at the same time, directory reads pick
  the account token first (ADR-0034).
- Two phones of one user on the same platform share a `device_name` and therefore revoke each other
  (the server rule from ADR-0008); a per-install id would need new storage and was not added.

## Not exercised / limits

- Keystore and Keychain behaviour was not exercised on a device: the integration test replaces the
  token store with an in-memory one (so several people can share one emulator), and unit tests use
  fakes. iOS Keychain was not run.
- Evidence: `test/core/token_store_test.dart`, `test/core/api_client_test.dart`.
- Real Apple and Google sign-in were not exercised (fakes only).
