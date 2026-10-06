# Architecture Decision Records

One decision per file, numbered sequentially (`NNNN-short-title.md`). An ADR is never rewritten
after acceptance; a later ADR supersedes it and both link to each other.

Each record contains: Status, Date, Deciders, Context, Options (when more than one was weighed),
Decision, Consequences.

Number ranges are reserved per delivery phase. A reserved range that is not fully used stays
documented here, so a gap in the numbering is always explained.

| ADR                                                   | Title                                               | Status   |
| ----------------------------------------------------- | --------------------------------------------------- | -------- |
| [0001](0001-stack-and-versions.md)                    | Stack and resolved versions                         | Accepted |
| [0002](0002-hosting.md)                               | Hosting                                             | Accepted |
| [0003](0003-sms-provider.md)                          | SMS provider                                        | Accepted |
| [0004](0004-portfolio-delivery-scope.md)              | Portfolio delivery scope and evidence limits        | Accepted |
| [0005](0005-session-model.md)                         | Session model                                       | Accepted |
| [0006](0006-integrity-verifier-and-local-adapters.md) | Integrity verifier and local-only adapters          | Accepted |
| [0007](0007-tenancy-and-permission-enforcement.md)    | Tenancy and permission enforcement                  | Accepted |
| [0008](0008-problem-details-and-error-codes.md)       | Problem Details and the error code registry         | Accepted |
| [0009](0009-rate-limiting-and-client-ip.md)           | Rate limiting and client IP                         | Accepted |
| [0010](0010-security-headers-csp-and-https.md)        | Security headers, CSP nonce, CORS off and HTTPS     | Accepted |
| [0011](0011-structured-logging-and-masking.md)        | Structured logging and masking                      | Accepted |
| [0012](0012-architecture-rules-and-test-strategy.md)  | Architecture rules and test strategy                | Accepted |
| 0013-0020                                             | Phase 2 decisions (sync, ledger, reminders, media)  | Reserved |
| 0021-0030                                             | Phase 3 decisions (Android app)                     | Reserved |
| 0031-0038                                             | Phase 4 decisions (billing, webhooks, admin)        | Reserved |
| 0039-0046                                             | Phase 5 decisions (web, SEO and GEO)                | Reserved |
| 0047-0056                                             | Phase 6 decisions (hardening and release readiness) | Reserved |

ADR-0001 records the toolchain decision (JDK 21 toolchain, Gradle 9.7.0, Android Gradle Plugin
9.3.3, Kotlin 2.4.20, Spring Boot 4.1.1 superseding the "Spring Boot 3" wording of the product spec,
the `compileSdk` 37 deviation) and the resolved library and image versions, taken from the Phase 0
scaffolds that were built.

ADR-0005 to ADR-0012 record the Phase 1 server decisions: the session model, the integrity verifier
and the local-only adapters, tenancy and permission enforcement (including the settled matrix
decisions D-1, D-2, D-5 and D-6 and the deferred D-7), the problem registry, rate limiting, headers
and HTTPS, logging, and the architecture rules. The range 0005-0012 is fully used.
