# Architecture Decision Records

One decision per file, numbered sequentially (`NNNN-short-title.md`). An ADR is never rewritten
after acceptance; a later ADR supersedes it and both link to each other.

Each record contains: Status, Date, Deciders, Context, Options (when more than one was weighed),
Decision, Consequences.

Number ranges are reserved per delivery phase. A reserved range that is not fully used stays
documented here, so a gap in the numbering is always explained.

| ADR                                                                 | Title                                                     | Status                  |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------- |
| [0001](0001-stack-and-versions.md)                                  | Stack and resolved versions                               | Accepted                |
| [0002](0002-hosting-and-payment-provider.md)                        | Hosting and payment provider                              | Accepted                |
| [0003](0003-map-tiles.md)                                           | Map tiles: keyless source, PMTiles self-hosting condition | Accepted                |
| [0004](0004-push-and-firebase-policy.md)                            | Push notifications and Firebase configuration policy      | Accepted                |
| [0005](0005-financial-record-retention.md)                          | Financial record retention                                | Proposed: open question |
| [0006](0006-portfolio-delivery-scope.md)                            | Portfolio delivery scope and evidence limits              | Accepted                |
| [0007](0007-visual-identity-revision.md)                            | Visual identity revision                                  | Accepted                |
| [0008](0008-authentication-model.md)                                | Authentication model                                      | Accepted                |
| [0009](0009-password-hashing-and-abuse-limits.md)                   | Password hashing, breach check and abuse limits           | Accepted                |
| [0010](0010-error-contract.md)                                      | Error contract                                            | Accepted                |
| [0011](0011-transport-and-browser-security.md)                      | Transport and browser security                            | Accepted                |
| [0012](0012-logging-and-sql-safety.md)                              | Logging and SQL safety                                    | Accepted                |
| [0013](0013-authorization-model.md)                                 | Authorization model                                       | Accepted                |
| [0014](0014-data-layer.md)                                          | Data layer                                                | Accepted                |
| [0015](0015-shop-registration-and-verification.md)                  | Shop registration and verification states                 | Accepted                |
| [0016](0016-shop-directory-slugs-and-resource-shapes.md)            | Shop directory, slugs and public versus owner shapes      | Accepted                |
| [0017](0017-shop-document-upload.md)                                | Shop document upload and private storage                  | Accepted                |
| [0018](0018-account-deletion.md)                                    | Account deletion, grace period and hard delete            | Accepted                |
| [0019](0019-anonymous-attestation-and-device-tokens.md)             | Anonymous attestation and device tokens                   | Accepted                |
| [0020](0020-hook-reservation-and-redemption.md)                     | Hook reservation and redemption engine                    | Accepted                |
| [0021](0021-push-delivery-and-simulated-adapter-guards.md)          | Push delivery and simulated adapter guards                | Accepted                |
| [0022](0022-impact-aggregates.md)                                   | Impact aggregates and the small-cell rule                 | Accepted                |
| [0023](0023-route-classification-and-authorization-completeness.md) | Route classification and authorization completeness       | Accepted                |
| [0024](0024-openapi-contract-test.md)                               | OpenAPI document and contract test                        | Accepted                |
| 0025-0032                                                           | Phase 3 decisions (payments, admin)                       | Reserved                |
| 0033-0042                                                           | Phase 4 decisions (Flutter app)                           | Reserved                |
| 0043-0052                                                           | Phase 5 decisions (web, SEO and GEO, impact pages)        | Reserved                |
| 0053-0062                                                           | Phase 6 decisions (hardening and release readiness)       | Reserved                |
