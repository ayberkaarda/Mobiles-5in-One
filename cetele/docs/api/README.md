# API documentation

The HTTP contract of the server (`/v1`, JSON, RFC 9457 Problem Details) is described by an OpenAPI
document, `openapi.json`, exported from the server with springdoc-openapi. It arrives in Phase 2
together with the domain endpoints and is checked by a contract test against the real responses.
The Android app reads it; it changes only through the handoff route in
[docs/handoffs](../handoffs/README.md).

Until then this folder only holds this note. The endpoint list and the role required by each
endpoint are in [the authorization matrix](../security/authorization-matrix.md).
