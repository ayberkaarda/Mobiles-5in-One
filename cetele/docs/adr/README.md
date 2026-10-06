# Architecture Decision Records

One decision per file, numbered sequentially (`NNNN-short-title.md`). An ADR is never rewritten
after acceptance; a later ADR supersedes it and both link to each other.

Each record contains: Status, Date, Deciders, Context, Options (when more than one was weighed),
Decision, Consequences.

Number ranges are reserved per delivery phase. A reserved range that is not fully used stays
documented here, so a gap in the numbering is always explained.

| ADR                                                        | Title                                               | Status   |
| ---------------------------------------------------------- | --------------------------------------------------- | -------- |
| [0001](0001-stack-and-versions.md)                         | Stack and resolved versions                         | Accepted |
| [0002](0002-hosting.md)                                    | Hosting                                             | Accepted |
| [0003](0003-sms-provider.md)                               | SMS provider                                        | Accepted |
| [0004](0004-portfolio-delivery-scope.md)                   | Portfolio delivery scope and evidence limits        | Accepted |
| [0005](0005-session-model.md)                              | Session model                                       | Accepted |
| [0006](0006-integrity-verifier-and-local-adapters.md)      | Integrity verifier and local-only adapters          | Accepted |
| [0007](0007-tenancy-and-permission-enforcement.md)         | Tenancy and permission enforcement                  | Accepted |
| [0008](0008-problem-details-and-error-codes.md)            | Problem Details and the error code registry         | Accepted |
| [0009](0009-rate-limiting-and-client-ip.md)                | Rate limiting and client IP                         | Accepted |
| [0010](0010-security-headers-csp-and-https.md)             | Security headers, CSP nonce, CORS off and HTTPS     | Accepted |
| [0011](0011-structured-logging-and-masking.md)             | Structured logging and masking                      | Accepted |
| [0012](0012-architecture-rules-and-test-strategy.md)       | Architecture rules and test strategy                | Accepted |
| [0013](0013-sync-protocol-and-change-log.md)               | Sync protocol and change log                        | Accepted |
| [0014](0014-ledger-model.md)                               | Ledger model                                        | Accepted |
| [0015](0015-statement-links-and-public-page.md)            | Statement links and the public statement page       | Accepted |
| [0016](0016-sms-reminders-and-netgsm-client.md)            | SMS reminders and the Netgsm client                 | Accepted |
| [0017](0017-media-pipeline.md)                             | Media pipeline                                      | Accepted |
| [0018](0018-account-and-shop-deletion.md)                  | Account and shop deletion                           | Accepted |
| [0019](0019-ownership-transfer-and-reauthentication.md)    | Ownership transfer and re-authentication            | Accepted |
| [0020](0020-refresh-family-lifetime-and-auth-retention.md) | Refresh family lifetime and auth retention          | Accepted |
| 0021-0030                                                  | Phase 3 decisions (Android app)                     | Reserved |
| 0031-0038                                                  | Phase 4 decisions (billing, webhooks, admin)        | Reserved |
| 0039-0046                                                  | Phase 5 decisions (web, SEO and GEO)                | Reserved |
| 0047-0056                                                  | Phase 6 decisions (hardening and release readiness) | Reserved |

ADR-0001 records the toolchain decision (JDK 21 toolchain, Gradle 9.7.0, Android Gradle Plugin
9.3.3, Kotlin 2.4.20, Spring Boot 4.1.1 superseding the "Spring Boot 3" wording of the product spec,
the `compileSdk` 37 deviation) and the resolved library and image versions, taken from the Phase 0
scaffolds that were built.

ADR-0005 to ADR-0012 record the Phase 1 server decisions: the session model, the integrity verifier
and the local-only adapters, tenancy and permission enforcement (including the settled matrix
decisions D-1, D-2, D-5 and D-6 and the deferred D-7), the problem registry, rate limiting, headers
and HTTPS, logging, and the architecture rules. The range 0005-0012 is fully used.

ADR-0013 to ADR-0020 record the Phase 2 server decisions: the sync protocol and change log (with
the settled matrix decision D-8), the ledger model, statement links and the public page (D-3), the
SMS reminders and the Netgsm client (superseding the value-type paragraph of ADR-0003 and the
`WebClient` wording of the spec), the media pipeline (D-4), account and shop deletion (including
rule 7 of the architecture tests, which turns the known gap of ADR-0012 into an allowlist),
ownership transfer with re-authentication (D-7), and the 180-day refresh family lifetime with
retention (superseding two consequences of ADR-0005). The range 0013-0020 is fully used.
