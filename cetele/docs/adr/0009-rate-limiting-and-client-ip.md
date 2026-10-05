# ADR-0009: Rate limiting and client IP

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

Spec section 6 item 5 limits OTP requests (3 per 10 minutes per phone, 10 per 10 minutes per IP),
verification attempts and refresh, and requires the client IP to come from the trusted proxy
header only. SMS pumping and brute force are the two threats (threat model 4.2 and 4.3). The MVP
runs one server instance.

## Decision

### Buckets

Bucket4j with a Caffeine-backed proxy manager (`bucket4j_jdk17-caffeine`), at most 200 000 keys,
entries expire once refilled. Refill is interval based: the whole capacity returns at the end of
the window, so "3 per 10 minutes" never allows a fourth call inside it. A rejected call is
`429 rate_limited` with `Retry-After` in whole seconds, at least 1.

| Limit               | Key                         | Capacity and window | Endpoint                    |
| ------------------- | --------------------------- | ------------------- | --------------------------- |
| `OTP_REQUEST_IP`    | `otp.ip:<ip>`               | 10 per 10 minutes   | `otp/request`               |
| `OTP_REQUEST_PHONE` | `otp.phone:<sha256(phone)>` | 3 per 10 minutes    | `otp/request`               |
| `OTP_VERIFY_IP`     | `otp.verify.ip:<ip>`        | 20 per 10 minutes   | `otp/verify`                |
| `REFRESH_DEVICE`    | `refresh.device:<deviceId>` | 30 per minute       | `auth/refresh`              |
| `REFRESH_IP`        | `refresh.ip:<ip>`           | 30 per minute       | `auth/refresh`              |
| invitation accept   | `invite.accept:<userId>`    | 10 per 10 minutes   | `invitations/{code}/accept` |

Further rules:

- `otp/request` order: validation, IP bucket, integrity check, phone bucket. The phone bucket is
  charged only after a valid integrity verdict, so a script without a verdict cannot lock a
  victim's number out. The IP bucket is charged first so a flood of invalid tokens is limited too.
- Refresh: a token that is unknown is charged to the IP bucket, a known token to its device bucket.
- Invitation accept: the bucket is charged on every attempt, valid or not, per user.
- Phone numbers are keyed by their SHA-256, never in clear text.
- The per-attempt limit of 5 wrong codes belongs to the code itself ([ADR-0005](0005-session-model.md)).

### Client IP and trusted proxies

- `ClientIp.of(request)` reads `remoteAddr` only. It never parses `X-Forwarded-For` itself.
- Tomcat's remote IP valve rewrites `remoteAddr` and the scheme from `X-Forwarded-For` and
  `X-Forwarded-Proto` only when the immediate peer matches `CETELE_TRUSTED_PROXIES`
  (`server.forward-headers-strategy=native`). Boot 4.1 trusts every private range, including
  `127.0.0.0/8`, by default for `internal-proxies`; both `server.tomcat.remoteip.internal-proxies`
  and `trusted-proxies` are therefore bound to `CETELE_TRUSTED_PROXIES`. Empty (the default)
  trusts nobody.
- Production must set `CETELE_TRUSTED_PROXIES` to the TLS proxy. Without it the server never sees
  `X-Forwarded-Proto: https`, so with HTTPS-only mode on ([ADR-0010](0010-security-headers-csp-and-https.md))
  every request looks like plain HTTP and is redirected in a loop. This is a documented
  deployment requirement ([env.md](../ops/env.md)).

## Consequences

- Buckets live in process memory. There is no limiting across instances: a second instance doubles
  every budget, and a restart resets all counters. Multi-instance deployment needs a shared bucket
  backend (Bucket4j supports one); not built.
- `TrustedProxyTest` runs against a real server on a random port over raw sockets (the valve does
  not run under MockMvc) with `CETELE_TRUSTED_PROXIES` set to `127.0.0.2`. It proves two cases:
  spoofed `X-Forwarded-For` from the untrusted peer `127.0.0.1` does not change the bucket key (the
  11th request is 429), and `X-Forwarded-For` from the trusted `127.0.0.2` decides the key (one
  forwarded client shares a bucket, another forwarded client has its own). Both peers are loopback
  addresses of the test machine: no real reverse proxy was ever in front of the server
  (`not exercised`).
- Behind a trusted proxy that appends rather than replaces `X-Forwarded-For`, the valve's rules
  decide the client address; that interaction is not tested.
- Evidence: `OtpRequestTest`, `OtpVerifyTest`, `RefreshRotationTest`, `InvitationFlowTest`,
  `TrustedProxyTest`.
