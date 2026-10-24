"""Выгрузка OpenAPI-схемы в docs/openapi.json — контракт между бэкендом и фронтендом."""

import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from adoption_compass.api import create_app
from adoption_compass.config import Settings

TARGET = Path(__file__).resolve().parent.parent / "docs" / "openapi.json"


def build_schema() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as tmp:
        settings = Settings(db_path=Path(tmp) / "schema.db", static_dir=Path(tmp))
        schema: dict[str, Any] = create_app(settings).openapi()
    return schema


def render() -> str:
    return json.dumps(build_schema(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main() -> int:
    text = render()
    if "--check" in sys.argv:
        if not TARGET.exists() or TARGET.read_text(encoding="utf-8") != text:
            print("docs/openapi.json устарел: выполните `make openapi`", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(text, encoding="utf-8")
    print(f"Записано: {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
