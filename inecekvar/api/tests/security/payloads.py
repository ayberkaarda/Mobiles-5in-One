"""Stored-XSS payloads (spec section 6 item 16) shared by the API suite and both e2e sweeps.

The list starts with the 14 payloads of the Askida sweep (`askida/docs/security/xss-sweep.md`)
and adds the Inecek Var cases: line and paragraph separators, a JSON-LD breakout, `javascript:`
and `data:` URLs, bidi and zero-width characters, template probes, NUL and very long text.

`apps/web-e2e/src/xss-payloads.json` is the same list for the Playwright specs;
`test_attack_suite.py::test_payload_file_matches_the_python_list` keeps both identical.

`refused` names the payloads the API must refuse at validation (control and format characters,
Unicode category C): for them the sweep records input validation, not output escaping.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Payload:
    name: str
    value: str
    refused: bool = False


LONG_UNIT = "<b onmouseover=alert(1)>x</b>"

PAYLOADS: tuple[Payload, ...] = (
    # The 14 payloads of the Askida sweep.
    Payload("script-element", "<script>alert(1)</script>"),
    Payload("img-onerror", "<img src=x onerror=alert(1)>"),
    Payload("javascript-href", '<a href="javascript:alert(1)">tikla</a>'),
    Payload("svg-onload", "<svg onload=alert(1)>"),
    Payload("attribute-breakout", '"><svg/onload=alert(1)>'),
    Payload("template-braces", "{{7*7}} {{constructor.constructor('alert(1)')()}}"),
    Payload("template-literal", "${7*7}"),
    Payload("markdown-javascript-link", "[tikla](javascript:alert(1))"),
    Payload("entity-double-encoding", "&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;"),
    Payload("style-import", "<style>@import url(//attacker.test/a.css)</style>"),
    Payload("long-markup", LONG_UNIT * 40),
    Payload("rtl-override", "\u202e<script>alert(1)</script>\u202d", refused=True),
    Payload("closing-script", "</script><script>alert(1)</script>"),
    Payload("comment-opener", "<!--<script>"),
    # Inecek Var additions.
    Payload("line-separators", "a\u2028b\u2029c</script>"),
    Payload("json-ld-breakout", '"}</script><script>alert(1)</script>'),
    Payload("javascript-url", "javascript:alert(1)"),
    Payload("data-url", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="),
    Payload("svg-image", "<svg><image href=x onerror=alert(1)></image></svg>"),
    Payload("bidi-isolate", "\u2066abc\u2069 \u202bdef\u202c", refused=True),
    Payload("zero-width", "a\u200bb\u200dc\ufeffd", refused=True),
    Payload("nul-byte", "a\u0000<script>alert(1)</script>", refused=True),
    Payload("very-long", "A" * 5000),
)

REFUSED: tuple[Payload, ...] = tuple(payload for payload in PAYLOADS if payload.refused)
STORED: tuple[Payload, ...] = tuple(payload for payload in PAYLOADS if not payload.refused)


def fit(value: str, limit: int) -> str:
    """The payload cut to a field limit (code points), as the e2e sweep stores it."""
    return value[:limit]


def as_json() -> list[dict[str, object]]:
    return [
        {"name": payload.name, "value": payload.value, "refused": payload.refused}
        for payload in PAYLOADS
    ]
