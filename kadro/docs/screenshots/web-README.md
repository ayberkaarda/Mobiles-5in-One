# Web screenshots

Screenshots of the production build of `apps/web` (`next build` + `next start`), taken in Google
Chrome with reduced motion and loaded web fonts. Every image shows **sample data**: the seeded
districts and `[ÖRNEK]` sample venues, plus a sample team, two open calls, a team invite and one
staff account created by the script at run time. No real person, venue or team appears.

- Desktop: 1440x900 viewport, device scale factor 1.
- Mobile: 390x844 viewport, device scale factor 1, touch.
- Full-page shots are cut at 1400 px height. Files are 256-colour palette PNGs.

## Files (`web/`)

| File                             | Page                                         | Viewport | Data                                                                    |
| -------------------------------- | -------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `web-01-home.png`                | `/` home                                     | desktop  | static copy                                                             |
| `web-02-features.png`            | `/ozellikler` features                       | desktop  | static copy                                                             |
| `web-03-blog.png`                | `/blog` index                                | desktop  | blog articles from `content/blog`                                       |
| `web-04-blog-article.png`        | `/blog/kadro-nasil-kurulur`                  | desktop  | blog article                                                            |
| `web-05-venue.png`               | `/saha/ornek-kadikoy-hali-saha-a` venue page | desktop  | sample data: `[ÖRNEK]` venue with the visible sample notice             |
| `web-06-district.png`            | `/eksik-var/istanbul/kadikoy` district page  | desktop  | sample data: two open calls of a sample team, one sample venue          |
| `web-07-faq.png`                 | `/sss` FAQ                                   | desktop  | static copy                                                             |
| `web-08-invite.png`              | `/mac/<code>` team invite landing            | desktop  | sample data: invite of the sample team (code created at run time)       |
| `web-09-privacy.png`             | `/gizlilik` privacy page                     | desktop  | sample text, shows the sample notice                                    |
| `web-10-admin-login.png`         | `/admin/giris` staff sign-in                 | desktop  | empty form                                                              |
| `web-11-admin-venues.png`        | `/admin/sahalar` venue verification queue    | desktop  | sample data: pending `[ÖRNEK]` venues, after password + TOTP sign-in    |
| `web-12-admin-audit.png`         | `/admin/denetim` audit log                   | desktop  | sample data: the step-up and one venue verification by the sample admin |
| `web-13-og-card.png`             | `/og/kadro.png` Open Graph card (1200x630)   | n/a      | the image as served                                                     |
| `web-mobile-01-home.png`         | `/` home                                     | mobile   | static copy                                                             |
| `web-mobile-02-blog-article.png` | `/blog/kadro-nasil-kurulur`                  | mobile   | blog article                                                            |
| `web-mobile-03-venue.png`        | `/saha/ornek-kadikoy-hali-saha-a` venue page | mobile   | sample data                                                             |
| `web-mobile-04-district.png`     | `/eksik-var/istanbul/kadikoy` district page  | mobile   | sample data                                                             |
| `web-mobile-05-invite.png`       | `/mac/<code>` team invite landing            | mobile   | sample data                                                             |

## Regenerate

From `kadro/`, with Docker and Google Chrome available:

```sh
pnpm install
pnpm build
node ops/take-web-screenshots.mjs --python <python with Pillow>
```

[`ops/take-web-screenshots.mjs`](../../ops/take-web-screenshots.mjs) starts a disposable PostGIS
container with a unique name, migrates and seeds it, adds the sample rows, serves the build with
`next start` on a free port (local configuration, secrets created at run time and never written
to disk), captures the pages with the installed `@playwright/test` (`channel: 'chrome'`), stops the
server and removes the container by its exact name. `--python` points at a Python interpreter
with Pillow and re-encodes the files as palette PNGs; without it the files stay as captured.
`--out <dir>` writes somewhere else than `docs/screenshots/web`. Dates in the open calls and the
audit log follow the day of the run.
