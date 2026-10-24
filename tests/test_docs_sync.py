"""Документация не должна расходиться с кодом: схема API, памятка, методология, ссылки и команды."""

import re
import runpy
from pathlib import Path

import pytest
import typer

from adoption_compass import cli
from adoption_compass.advisor import Advisor
from adoption_compass.assessment import AssessmentEngine, Process
from adoption_compass.catalog import load_catalog
from adoption_compass.safety import Policy
from adoption_compass.scoring import load_scoring

from .conftest import TODAY

ROOT = Path(__file__).resolve().parent.parent
MARKDOWN_FILES = sorted(
    p
    for p in [*ROOT.glob("*.md"), *ROOT.glob("docs/**/*.md"), *ROOT.glob("web/*.md")]
    if "node_modules" not in p.parts
)


def test_openapi_snapshot_is_current():
    module = runpy.run_path(str(ROOT / "scripts" / "export_openapi.py"))
    committed = (ROOT / "docs" / "openapi.json").read_text(encoding="utf-8")
    assert committed == module["render"](), "docs/openapi.json устарел: выполните `make openapi`"


def test_employee_handout_is_generated_from_the_policy():
    committed = (ROOT / "docs" / "training" / "safe-ai-handout.md").read_text(encoding="utf-8")
    assert committed == Policy.load().handout_markdown()


def _spaced(value: float) -> str:
    return f"{round(value):,}".replace(",", " ")


def test_methodology_example_matches_the_engine():
    engine = AssessmentEngine(load_scoring(), Advisor(load_catalog(), Policy.load(), today=TODAY))
    process = Process(
        id="X1",
        name="Пример",
        task_type="classification",
        runs_per_month=1000,
        minutes_per_run=6,
        hourly_cost_rub=1000,
        error_rate=0,
        error_cost_rub=0,
        standardization=5,
        digital_readiness=5,
        risk_level=1,
        data_sensitivity="public",
    )
    result = engine.assess([process], {"llm_overhead": 1.0}).processes[0]
    text = (ROOT / "docs" / "METHODOLOGY.md").read_text(encoding="utf-8")
    expectations = [
        _spaced(result.savings_month_rub),
        _spaced(result.implementation_rub),
        _spaced(result.net_month_rub),
        _spaced(result.net_horizon_rub),
        f"{result.payback_months:.2f}".replace(".", ","),
        f"{result.impact:.1f}".replace(".", ","),
        f"{result.ease:.1f}".replace(".", ","),
        f"{result.priority:.1f}".replace(".", ","),
        _spaced(next(s for s in result.scenarios if s.key == "pessimistic").net_horizon_rub),
        _spaced(next(s for s in result.scenarios if s.key == "optimistic").net_horizon_rub),
    ]
    missing = [value for value in expectations if value not in text]
    assert not missing, f"в METHODOLOGY.md нет значений из движка: {missing}"


LINK = re.compile(r"\]\((?!https?://|mailto:|#)([^)\s#]+)")


@pytest.mark.parametrize("path", MARKDOWN_FILES, ids=lambda p: str(p.relative_to(ROOT)))
def test_relative_links_point_to_existing_files(path: Path):
    broken = [
        target
        for target in LINK.findall(path.read_text(encoding="utf-8"))
        if not (path.parent / target).resolve().exists()
    ]
    assert not broken, f"{path.relative_to(ROOT)}: битые ссылки {broken}"


COMPASS_CALL = re.compile(r"(?:^|`|\$ )(compass [^`\n]+)", re.MULTILINE)


def _subcommands(command: object) -> dict[str, object] | None:
    """Подкоманды группы; у «листовой» команды их нет (Typer использует собственные классы click)."""
    commands = getattr(command, "commands", None)
    return commands if isinstance(commands, dict) else None


def _option_names(command: object) -> set[str]:
    names = {"--help"}
    for param in getattr(command, "params", []):
        names |= {o for o in [*param.opts, *param.secondary_opts] if o.startswith("-")}
    return names


def _check_command(line: str) -> str | None:
    """Вернуть описание проблемы, если команда или её опции не существуют."""
    tokens = line.split()[1:]
    command: object = typer.main.get_command(cli.app)
    path = ["compass"]
    index = 0
    while (children := _subcommands(command)) is not None and index < len(tokens):
        token = tokens[index]
        if token.startswith(("-", "<")):
            break
        if token not in children:
            return f"неизвестная команда «{' '.join([*path, token])}»"
        command = children[token]
        path.append(token)
        index += 1
    if _subcommands(command) is not None:
        return None
    known = _option_names(command)
    for token in tokens[index:]:
        if token.startswith("--") and token.split("=")[0] not in known:
            return f"у команды «{' '.join(path)}» нет опции {token.split('=')[0]}"
    return None


@pytest.mark.parametrize("path", MARKDOWN_FILES, ids=lambda p: str(p.relative_to(ROOT)))
def test_documented_cli_commands_exist(path: Path):
    problems = []
    for match in COMPASS_CALL.finditer(path.read_text(encoding="utf-8")):
        line = match.group(1).strip().rstrip("\\").strip()
        parts = line.split()
        if len(parts) < 2 or parts[1] in {"…", "—", "..."}:
            continue
        problem = _check_command(line)
        if problem:
            problems.append(f"`{line}` → {problem}")
    assert not problems, f"{path.relative_to(ROOT)}: " + "; ".join(problems)
