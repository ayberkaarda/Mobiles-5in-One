# ADR-0047: Share images rendering and caching

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Shared shop links need a preview image. It must carry nothing beyond what the public page already
shows, must not outlive the listing for long, and must not make the origin a render farm.

## Decision

- `GET /og/dukkan/{slug}.png` draws a 1200x630 PNG with `intervention/image` 4.3.4 (GD driver, with
  FreeType, asserted by `FontsTest`). Frame: background Kireç `#F4F0E8`, a 4 px Kömür `#2B2B2B` rail,
  one Ekmek Kabuğu `#C8763A` tag with the punched hole, the wordmark "askıda" bottom left. The shop
  name is drawn in Bricolage Grotesque Display SemiBold (76 px, wrapped at 880 px, whitespace
  collapsed, cut at 48 characters with an ellipsis); the font file is a byte copy of the brand file
  (sha256 equality tested). GD draws text, it never interprets it. No address, count or person.
- Only listed shops (ADR-0046 rule) get an image; anything else is 404 with `X-Robots-Tag: noindex`.
- One file per shop. Files live on the `og_cache_disk` (`public`, local storage) as
  `og/shops/<slug>-<sha1(name, updated_at)>.png` and are served with
  `Cache-Control: public, max-age=86400`. After a new file is written, older variants of the same
  shop are deleted; deletion matches exactly `<slug>-<40 hex>.png`, so a shop whose slug is a prefix
  of another's never deletes the other's image (tested).
- Post-write recheck: after writing, the listing is read again (verified, listed, sample policy). If
  the shop stopped being public in the meantime, the file just written is deleted. This closes the
  race between drawing and unlisting, where the observer's cleanup may already have run.
- Unlisting, leaving `verified`, rename and deletion remove the files through the observer
  (ADR-0046).
- The site-wide default `public/og/default.png` (1200x630, brand frame and the tagline only) is
  produced by `php artisan web:og-default` and committed.

## Consequences

- Accepted risk (also in ADR-0046): downstream caches may hold an unlisted shop's image for up to
  24 hours. Setting a shorter `max-age` would cost more renders; the content is the shop name only.
- not exercised: images on MinIO or a CDN: the disk is local storage by configuration; MinIO is only
  used by the document upload tests.
