# Phase 1 package 1A: 0 done, 3 partial, 20 not-started

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Remove secrets from source | not-started | planned: phase 0 |
| 2 | Purge secrets from history | not-started | planned: phase 6 |
| 3 | Define authorization rules | not-started | planned: phase 1 |
| 4 | Enforce authorization on server | partial | database layer only: `api/tests/migrations/test_constraints.py::test_no_self_review` passed (a reviewer equal to the author is rejected, SQLSTATE 23514; ADR-0006). not exercised: API policy and IDOR suite (planned: phase 1) |
| 5 | Rate limit entry points | not-started | planned: phase 1 |
| 6 | Validate input | partial | database layer only: `test_fare_boundary`, `test_trace_bounds[1]`, `test_trace_bounds[5001]`, `test_route_length`, `test_invalid_mode`, `test_email_lowercase` in `api/tests/migrations/test_constraints.py` passed; the fare and immutability checks were mutation-tested (ADR-0006). not exercised: Pydantic request validation and body limits (planned: phase 1) |
| 7 | Constrain uploads | not-started | planned: phase 2 |
| 8 | Lock down CORS | not-started | planned: phase 1 |
| 9 | Set security headers | not-started | planned: phase 1 |
| 10 | Require HTTPS | not-started | planned: phase 1 |
| 11 | Hash passwords | not-started | planned: phase 1 |
| 12 | Secure cookies | not-started | planned: phase 1 |
| 13 | Limit error details | not-started | planned: phase 1 |
| 14 | Sanitize logs | not-started | planned: phase 1 |
| 15 | Parameterize queries | not-started | planned: phase 1 |
| 16 | Escape against XSS | not-started | planned: phase 6 |
| 17 | Verify webhook signatures | not-started | planned: phase 5 |
| 18 | Assign admin roles | not-started | planned: phase 4 |
| 19 | Audit packages | not-started | planned: phase 6 |
| 20 | Automate backups | not-started | planned: phase 6 |
| 21 | Delete accounts | partial | database layer only: `test_publisher_anonymisation` and `test_contribution_retention` in `api/tests/migrations/test_constraints.py` passed (deleting a user sets contribution authors and publishers to NULL and deletes private traces; ADR-0006). not exercised: the deletion flow, grace period and hard-delete job (planned: phase 2) |
| 22 | Set spending alerts | not-started | planned: phase 6 |
| 23 | Test as an attacker | not-started | planned: phase 6 |

The item names and acceptance scope follow section 6 of the product specification. Rows marked partial name the executed tests that back them (package 1A run, ADR-0006 evidence); every other row has no verification yet. A status may change only after its check has been executed and its output recorded.

