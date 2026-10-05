# ADR-0051: Legal and contact pages as labelled samples

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The app is not published and no legal entity, address or mailbox exists (ADR-0006). The KVKK
information text and the privacy text are still required by the specification, and the domain is not
owned, so an e-mail address on it must not look live.

## Decision

- `/gizlilik`, `/kvkk-aydinlatma`, `/hakkinda` and `/iletisim` show the banner "Örnek metin: hukuki
  inceleme öncesi taslaktır." at the top (`<x-web.sample-notice>`).
- The KVKK text carries the anonymity statement: no account, no identity, no precise location, no
  rating, 30-day aggregate counters, attestation verdict only. Its version string is `kvkk-2026-10`,
  the value the API accepts for `kvkk_consents.text_version`; a test registers a user with it. Facts
  in the texts come from ADR-0015, 0017, 0018, 0019, 0022 and the authorization matrix.
- The two legal pages name no data controller, address or e-mail: "veri sorumlusu bu örnekte
  belirlenmemiştir". Processors, cross-border transfer, financial record retention (ADR-0005) and the
  support channel are written as open ("henüz netleştirilmemiştir"), not invented. Tests grep the two
  views and the two sources for `@` and `mailto:`.
- The contact address is `WEB_CONTACT_EMAIL` (default `iletisim@askida.app`, a documented dummy). It
  appears on `/iletisim` and in `llms.txt` only, as plain text, never a `mailto:` link (a clickable
  address on a domain nobody owns would be a misleading affordance), followed by "örnek adres, aktif
  değil" while the sample notice is on, and the legal name. No contact form.
- A guardrail test rejects `mailto:` on every public page.

## Consequences

- The texts are drafts; they do not substitute legal advice. Replacing them needs the legal entity,
  the controller, the processors and a real mailbox.
- not exercised: legal review of any text, a working mailbox.
