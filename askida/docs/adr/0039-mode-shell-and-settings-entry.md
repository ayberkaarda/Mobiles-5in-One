# ADR-0039: Mode shell and settings entry

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

One app serves three kinds of person. A recipient has no account, so settings (language, theme, data
reset) cannot hang off an account screen, and the mode switch must work for everybody.

## Decision

- A mode shell (`lib/routing/mode_shell.dart`) wraps the three mode homes (recipient, donor, merchant)
  and carries the mode switcher. The mode home owns its feature routes as children, so the shell
  stays visible on them. Merchant and donor homes stay open without an account and show their own
  entry (sign in, intro); only the guarded sub-routes need an account (ADR-0033).
- The shell app bar has one settings action (`IconButton`, key `shell-settings`, gear icon, tooltip
  from the existing `settingsTitle` key) that pushes `/settings`. `/settings` is a top-level route
  without a guard, so it opens in every mode without an account and back returns to the same mode.
- Settings holds account actions (sign-out, deletion with re-auth, grace date), language (Turkish,
  English), theme (System, Light, Dark), push state and a privacy line. Language and theme persist
  through the settings store (ADR-0035); the app root watches them.
- The recipient mode default and onboarding stay in the recipient home: three steps without an account
  wall, with step 1 skipped when the device already has an anon token and steps 1 and 2 skipped when
  location permission is already granted.

## Consequences

- Recipients reach language and theme without any account.
- Before this change settings were reachable only from the donor home and auth flows.

## Not exercised / limits

- Evidence: `test/routing/mode_shell_test.dart` (one test per mode: the settings screen opens, the
  language and theme sections are visible, back keeps the mode). No emulator step opened settings.
