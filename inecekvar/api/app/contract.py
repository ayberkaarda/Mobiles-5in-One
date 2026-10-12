"""Write the OpenAPI contract: `uv run python -m app.contract` (spec section 5).

The document is emitted by FastAPI from the real `create_app` composition with local
settings (per-process keys, no connection is opened) and written to
`inecekvar/docs/api/openapi.json`. `libs/domain` derives its TypeScript types from that file;
CI regenerates both and fails on any difference (`git diff --exit-code`).
"""

import json
import sys
from pathlib import Path

from app.core.settings import Settings
from app.main import create_app, with_local_defaults

DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "docs" / "api" / "openapi.json"


def openapi_document() -> dict[str, object]:
    settings = with_local_defaults(Settings(env="local"))
    return create_app(settings).openapi()


def render(document: dict[str, object]) -> str:
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    output = Path(argv[1]) if len(argv) > 1 else DEFAULT_OUTPUT
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(render(openapi_document()), encoding="utf-8", newline="\n")
    print("OpenAPI written: " + str(output))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
