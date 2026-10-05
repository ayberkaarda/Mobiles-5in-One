# Handoffs

A handoff is a short written request from one work area to another when a change needs a file the
requester does not own (see the ownership table in [CONTRIBUTING.md](../../CONTRIBUTING.md)). The
owner of the target area decides, makes the change in their own area, and records the outcome in
the same file.

## File name

`<from>-to-<to>-<NNN>.md`, where `from` and `to` are owner names (`lead`, `server`, `android`,
`web`, `security`, `qa`) and `NNN` is a zero-padded counter per pair, starting at `001`.

Each file states: what is needed, why, the exact file or contract involved, the requested outcome,
and later a status line (`open`, `done`, `declined`) with the reason.

API contract changes follow the same route: `server` asks `lead` to update the API description in
[docs/api](../api/README.md).

## Index

No handoffs yet.
