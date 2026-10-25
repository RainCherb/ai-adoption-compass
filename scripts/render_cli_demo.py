"""Рендер терминального демо в SVG для README (Rich умеет экспортировать SVG)."""

import os
from collections.abc import Callable
from pathlib import Path

from rich.console import Console

os.environ.setdefault("COMPASS_TODAY", "2026-10-25")

from adoption_compass import cli

TARGET = Path(__file__).resolve().parent.parent / "docs" / "assets"


def render(
    name: str,
    title: str,
    sections: list[tuple[str, Callable[[cli.Services], None]]],
    width: int = 118,
) -> None:
    recorder = Console(record=True, width=width, force_terminal=True, color_system="truecolor")
    cli.console = recorder
    svc = cli._services()
    for heading, section in sections:
        if heading:
            recorder.rule(f"[bold]{heading}")
        section(svc)
    TARGET.mkdir(parents=True, exist_ok=True)
    path = TARGET / name
    recorder.save_svg(str(path), title=title)
    print(f"Записано: {path}")


def main() -> None:
    render("cli-assess.svg", "compass assess processes.csv", [("", cli.demo_assessment)])
    render(
        "cli-safety.svg",
        "compass scan · mask · prompt lint",
        [
            ("Безопасность: что можно отправлять в нейросеть", cli.demo_safety),
            ("Качество запроса", cli.demo_prompt_quality),
        ],
    )


if __name__ == "__main__":
    main()
