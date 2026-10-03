# Screenshots

## Mobile (Android)

Real screenshots of the Kadro app running on an Android emulator against a local stack with sample
data. Nothing is mocked up or edited beyond cropping and resizing.

Every screen exists twice: `mobile/<step>-light.png` with the emulator in light mode and
`mobile/<step>-dark.png` in dark mode (`cmd uimode night`). The app's own Görünüm setting stays
on Sistem, so the app follows the device. Step numbers keep the order of the earlier set; the
lineup was added as step 18 and is listed first.

| Step                            | Screen                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `18-match-lineup`               | Lineup (Kadro dizilişi) of the first match: pitch diagram with two players per side, the open places as eksik markers, the captain's side picker below |
| `01-welcome`                    | Welcome screen (`/`)                                                                                                                                   |
| `02-sign-in`                    | Sign-in form, filled (`/giris`)                                                                                                                        |
| `03-matches`                    | Matches tab (Maçlar) with two upcoming matches of the sample team                                                                                      |
| `04-match-detail-rsvp`          | Match detail: kick-off and squad count, facts, fee share, own RSVP ("Geliyorum") and the captain's controls                                            |
| `05-match-participants`         | Same match scrolled down: participants grouped by answer, with kit numbers and lineup sides                                                            |
| `06-teams`                      | Teams tab (Takımlar)                                                                                                                                   |
| `07-team`                       | Team page with the roster, seen by the captain                                                                                                         |
| `08-create-match`               | Create match form (Maç kur)                                                                                                                            |
| `09-open-calls`                 | Eksik Var tab: open calls list                                                                                                                         |
| `10-open-calls-district-filter` | Eksik Var with the filters open and the district filter set to Beşiktaş                                                                                |
| `11-venues`                     | Saha Rehberi (Sahalar tab): the seeded `[ÖRNEK]` sample venues                                                                                         |
| `12-venue-detail`               | Venue detail of a sample venue, with the sample and "not verified" notices                                                                             |
| `13-profile`                    | Profile with position, level, district and basic stats (0 played: no match has been played yet)                                                        |
| `14-settings`                   | Settings (Ayarlar) with the Görünüm choice on Sistem                                                                                                   |
| `15-pro-paywall-unavailable`    | Kadro Pro paywall in its "unavailable" state: the build has no store billing keys                                                                      |
| `16-matches-empty`              | Matches tab empty state (an account without a team)                                                                                                    |
| `17-teams-empty`                | Teams tab empty state                                                                                                                                  |

How they were taken:

- Device: Android emulator, AVD `Pixel_8` (1080 x 2400, 420 dpi), system image
  `android-37.2` Google APIs Play Store, 16 KB page size, `x86_64`, API level 37. App language set
  to Turkish with a per-app locale (`cmd locale set-app-locales app.kadro.mobile --locales tr-TR`).
- Build: debug variant of `apps/mobile` for `x86_64` only, with the JavaScript bundle embedded
  (built in a temporary copy of the repository outside the working tree; no repository file was
  changed). `EXPO_PUBLIC_APP_ENV=local`, `EXPO_PUBLIC_API_URL=http://localhost:3000` reached the
  host through `adb reverse`; no RevenueCat keys and no web origin, so the paywall shows
  "unavailable" and the settings show the legal links as not configured.
- Stack: `docker-compose.yml` with `apps/mobile/e2e/compose.e2e.yml` (PostgreSQL with PostGIS, web
  and API, worker), `db:migrate` and `db:seed` (districts and the `[ÖRNEK]` sample venues).
- Sample data: accounts created through the public API for this run only, every display name and
  team name starting with `[ÖRNEK]`, email addresses under `example.com`. One sample team with six
  members, two open matches (one at a sample venue, with RSVP answers from the members and a
  saved lineup of two players per side), and one open call of a second sample team. Dates and times are relative to the capture day; the emulator
  clock runs in UTC.
- Capture: `ops/take-mobile-screenshots.sh` (from `kadro/`). It creates the sample data
  (`ops/mobile-screenshots/seed.mjs`), then for each scheme (`KADRO_SHOTS_SCHEMES`, default
  `light dark`) switches the emulator night mode, clears the app data, sets the app locale, freezes the status
  bar clock (System UI demo mode), drives the app with the Maestro flow
  `ops/mobile-screenshots/flow.yaml` (`takeScreenshot`) and post-processes the images
  (`ops/mobile-screenshots/postprocess.py`): status bar cropped (132 px on this AVD, read from
  `dumpsys window`), resized to 540 px wide, palette-quantized PNG with Pillow, file name suffix `-light` or
  `-dark`. Each file is under 100 KB, each scheme about 0.6 MB. The emulator night mode is
  restored when the script ends.

Not covered: iOS, the Açık and Koyu app settings (only Sistem is captured), the push notification card (the build has no push configuration),
Apple and Google sign-in.

## Retaking the mobile screenshots

1. Start and seed the local stack and install a debug build on a running emulator as in
   `apps/mobile/e2e/README.md` (sections 1 and 3). Use a fresh database: open calls of earlier
   runs stay on the Eksik Var tab.
2. Put `adb`, `maestro` (2.9.0, as in the e2e README), `node` and Python 3 with Pillow on `PATH`.
3. From `kadro/`: `ops/take-mobile-screenshots.sh` (writes to `docs/screenshots/mobile`; pass
   another directory as the first argument to compare first). Set `KADRO_SHOTS_API_URL` when the
   API is not on `http://localhost:3000` and `KADRO_SHOTS_DB_CONTAINER` when the database does not
   run as the compose `postgres` service.

When a screen changes its `testID`s, update `ops/mobile-screenshots/flow.yaml`; file names come
from its `takeScreenshot` steps.
