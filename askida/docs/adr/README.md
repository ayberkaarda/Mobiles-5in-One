# Architecture Decision Records

One decision per file, numbered sequentially (`NNNN-short-title.md`). An ADR is never rewritten
after acceptance; a later ADR supersedes it and both link to each other.

Each record contains: Status, Date, Deciders, Context, Options (when more than one was weighed),
Decision, Consequences.

Number ranges are reserved per delivery phase. A reserved range that is not fully used stays
documented here, so a gap in the numbering is always explained.

| ADR                                          | Title                                                     | Status                  |
| -------------------------------------------- | --------------------------------------------------------- | ----------------------- |
| 0001                                         | Stack and resolved versions                               | Proposed                |
| [0002](0002-hosting-and-payment-provider.md) | Hosting and payment provider                              | Accepted                |
| [0003](0003-map-tiles.md)                    | Map tiles: keyless source, PMTiles self-hosting condition | Accepted                |
| [0004](0004-push-and-firebase-policy.md)     | Push notifications and Firebase configuration policy      | Accepted                |
| [0005](0005-financial-record-retention.md)   | Financial record retention                                | Proposed: open question |
| [0006](0006-portfolio-delivery-scope.md)     | Portfolio delivery scope and evidence limits              | Accepted                |
| 0007-0014                                    | Phase 1 decisions (Laravel core, auth, security baseline) | Reserved                |
| 0015-0024                                    | Phase 2 decisions (domain, anonymity, uploads)            | Reserved                |
| 0025-0032                                    | Phase 3 decisions (payments, admin)                       | Reserved                |
| 0033-0042                                    | Phase 4 decisions (Flutter app)                           | Reserved                |
| 0043-0052                                    | Phase 5 decisions (web, SEO and GEO, impact pages)        | Reserved                |
| 0053-0062                                    | Phase 6 decisions (hardening and release readiness)       | Reserved                |
