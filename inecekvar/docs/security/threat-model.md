# Threat model outline

## GPS trace privacy

Raw traces can reveal a contributor's home, routine or travel. Access is limited to the owner and moderators, public endpoints never expose traces, and deletion follows the specified retention period. Logs use rounded coordinates and exclude trace bodies.

## Data poisoning

A contributor may submit fabricated, misleading or malformed route geometry and fare details. Bounds, geometry validation, provenance and moderation review reduce this risk. Sample content remains clearly labeled and is not presented as real route data.

## Sockpuppet approval

An attacker may create multiple identities to build reputation or approve their own submissions. Rate limits, account controls, audit records and a server-side prohibition on self-approval are required. Moderation decisions remain attributable to an authorized reviewer.

## Planner denial of service

Pathological origins, destinations or graph inputs may consume excessive CPU or memory. Bound request size, transfer count and execution time, rate limit requests, and use the defined degraded response when capacity is constrained.

## PMTiles egress

Repeated or hotlinked tile downloads may exhaust bandwidth or create unexpected cost. Measure local archive size and request behaviour, then apply caching and download limits before any public deployment. Cloud storage and live egress are external gates.

## Plugin permission bypass

A native plugin or platform permission may expose location or local data beyond the intended use. Keep the allowlist narrow, request location only while the app is in use, and store refresh credentials only in platform secure storage. Review permission declarations against the selected plugin versions.

## SSR cache poisoning

Untrusted request headers or query values may influence rendered output shared through the server cache. Normalize cache keys, exclude personalized responses and reject invalid input before rendering. Test cache boundaries and response headers before public exposure.

## Account deletion

Deletion may leave personal information in traces, media, tokens, logs or backups. Revoke credentials and remove private data according to the deletion flow, while retaining only contributions permitted by the approved licence. Verify asynchronous deletion and backup retention behaviour before claiming completion.
