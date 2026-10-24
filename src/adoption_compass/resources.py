"""Загрузка встроенных файлов данных с возможностью переопределения каталогом пользователя."""

from importlib import resources
from pathlib import Path
from typing import Any

import yaml


def read_data_text(name: str, data_dir: Path | None = None) -> str:
    """Прочитать файл данных: сначала из data_dir, затем из встроенных."""
    if data_dir is not None:
        candidate = data_dir / name
        if candidate.is_file():
            return candidate.read_text(encoding="utf-8")
    node = resources.files("adoption_compass").joinpath("data", *name.split("/"))
    return node.read_text(encoding="utf-8")


def load_yaml(name: str, data_dir: Path | None = None) -> Any:
    return yaml.safe_load(read_data_text(name, data_dir))
