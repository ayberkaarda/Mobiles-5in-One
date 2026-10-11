# ADR-0005: Portfolio delivery scope and evidence limits

- Status: Accepted
- Deciders: Project owner

## Context

This repository demonstrates engineering work through local builds, tests and documentation. Several requirements depend on accounts, providers, a public domain, hardware or real community data that are not available in the local environment. A result is called done only when the command or check was run and its output is recorded. Fixture, emulator and local substitute results must identify the boundary they cover.

## Decision

Use local substitutes where available and report provider or environment gaps explicitly. Use `[ÖRNEK] Test Şehri` for sample content; do not invent real route data. Apply the status and class definitions in the external gates table: K means locally evidenced with a substitute, N means unavailable here, and P means partly covered. Every gate records why it remains open and its class.

| Gate | Why open | Class |
| --- | --- | --- |
| RevenueCat and Play or App Store accounts | No store or billing accounts are available | N |
| Resend live mail and domain verification | Mailpit covers local mail only; no live account or verified domain | P |
| Hosting, TLS and HSTS preload | No production host or domain | N |
| Cloudflare R2 | MinIO is the local object-storage substitute | P |
| iOS build | No macOS build host | N |
| Signed Android App Bundle | No signing keystore | N |
| AASA and assetlinks live validation | No public domain to serve and validate association files | N |
| Real-device route trace | Emulator GPX can cover a local flow; no physical device trace | P |
| Real route data and community | Deliberately absent; sample city is `[ÖRNEK] Test Şehri` | N |
| KVKK text and international transfer legal review | Legal review has not occurred | N |
| Sentry account | No account is available | N |

ADR ranges follow delivery phases: P1 0006–0019; P2 0020–0029; P3 0030–0039; P4 0040–0049; P5 0050–0059. Specification phases 4 and 5 are implemented together; ADR numbering follows these ranges.

## Consequences

Reports distinguish executed local proof from planned work and external gates. `done` requires executed output; a documented plan alone is not proof. The project cannot claim production hosting, store release, legal approval, live mail, live storage, real route data or a physical-device trace from local work.
