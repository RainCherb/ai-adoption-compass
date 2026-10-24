"""MCP-сервер: инструменты Compass для Claude Code, Codex, OpenCode, Kiro и других агентов.

Принцип приватности: инструменты ``*_file`` читают файлы локально внутри разрешённой папки и
возвращают агенту только метаданные — сырые персональные данные в контекст модели не попадают.

Ожидаемые сбои оформляются как ``ToolError``: SDK возвращает модели понятный текст ошибки
(``is_error=True``), а любое другое исключение считалось бы «падением» с обезличенным сообщением.
"""

import json
import os
from collections.abc import Iterator
from contextlib import contextmanager
from enum import StrEnum
from pathlib import Path
from typing import Any, TypeVar

from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from pydantic import ValidationError

from . import __version__
from .advisor import Preference, Workload
from .assessment import Process
from .config import Settings
from .domain import Sensitivity, TaskType
from .services import Services, build_services

INSTRUCTIONS = """\
AI Adoption Compass helps plan and de-risk AI adoption in a company.
Typical flow: (1) scan_sensitive_data / scan_file before any text leaves the perimeter,
(2) recommend_models for a workload, (3) assess_ai_use_cases for a list of business processes,
(4) lint_prompt / render_prompt_template for reusable prompts.
Cost and quality numbers come from a demonstration catalog: verify prices before decisions.
"""

E = TypeVar("E", bound=StrEnum)


@contextmanager
def _user_errors() -> Iterator[None]:
    """Преобразовать ожидаемые ошибки ввода в ToolError с понятным текстом."""
    try:
        yield
    except ToolError:
        raise
    except ValidationError as exc:
        details = "; ".join(
            f"{'.'.join(str(part) for part in err['loc'])}: {err['msg']}" for err in exc.errors()
        )
        raise ToolError(f"Некорректные параметры: {details}") from exc
    except KeyError as exc:
        raise ToolError(f"Не найдено: {exc.args[0]}") from exc
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


def _enum(enum_cls: type[E], value: str, name: str) -> E:
    try:
        return enum_cls(value)
    except ValueError:
        allowed = ", ".join(m.value for m in enum_cls)
        raise ValueError(f"{name}: неизвестное значение «{value}», допустимо: {allowed}") from None


def _inside(root: Path, raw: str) -> Path:
    """Путь строго внутри разрешённой папки (с учётом симлинков и абсолютных путей)."""
    candidate = (root / raw).resolve()
    if not candidate.is_relative_to(root):
        raise ValueError(f"Путь вне разрешённой папки: {raw}")
    return candidate


def _read_inside(svc: Services, root: Path, raw: str) -> str:
    path = _inside(root, raw)
    if not path.is_file():
        raise ValueError(f"Файл не найден: {raw}")
    if path.stat().st_size > svc.settings.max_upload_bytes:
        raise ValueError(f"Файл больше {svc.settings.max_upload_bytes // 1000} КБ")
    return path.read_text(encoding="utf-8", errors="replace")


def _check_length(svc: Services, text: str) -> None:
    if len(text) > svc.settings.max_text_chars:
        raise ValueError(f"Текст длиннее {svc.settings.max_text_chars} символов")


def create_mcp_server(services: Services | None = None, root: Path | None = None) -> MCPServer:
    svc = services or build_services(Settings.from_env(), with_storage=False)
    base = (root or svc.settings.mcp_root).resolve()
    server = MCPServer("ai-adoption-compass", instructions=INSTRUCTIONS, version=__version__)

    @server.tool()
    def assess_ai_use_cases(
        processes: list[dict[str, Any]],
        assumptions: dict[str, Any] | None = None,
        top: int = 10,
    ) -> dict[str, Any]:
        """Rank business processes for AI automation: fit, ROI scenarios, priority and roadmap.

        Each process needs: name, task_type (classification, extraction, summarization, drafting,
        qa_search, translation, analysis, code, decision_support), runs_per_month, minutes_per_run.
        Optional: id, department, hourly_cost_rub, error_rate, error_cost_rub, standardization (1-5),
        digital_readiness (1-5), risk_level (1-5), data_sensitivity, must_self_host.
        """
        with _user_errors():
            parsed = [
                Process.model_validate({"id": f"P{i:02d}", **p})
                for i, p in enumerate(processes, start=1)
            ]
            result = svc.engine.assess(parsed, assumptions)
        return {
            "summary": result.summary.model_dump(mode="json"),
            "roadmap": [w.model_dump(mode="json") for w in result.roadmap],
            "top": [
                {
                    "rank": p.rank,
                    "id": p.id,
                    "name": p.name,
                    "quadrant": p.quadrant.value,
                    "model": p.model.name if p.model else None,
                    "hours_saved_month": p.hours_saved_month,
                    "payback_months": p.payback_months,
                    "net_horizon_rub": p.net_horizon_rub,
                    "flags": [f.message for f in p.flags if f.severity.value != "info"],
                }
                for p in result.processes[: max(1, top)]
            ],
            "warnings": result.warnings,
        }

    @server.tool()
    def recommend_models(
        task_type: str,
        requests_per_month: int,
        tokens_in: int,
        tokens_out: int,
        data_sensitivity: str = "internal",
        min_quality: int = 3,
        monthly_budget_rub: float | None = None,
        needs_vision: bool = False,
        needs_tool_calling: bool = False,
        must_self_host: bool = False,
        allow_workarounds: bool = False,
        prefer: str = "balanced",
        top: int = 3,
    ) -> dict[str, Any]:
        """Recommend LLMs for a workload under data-policy, Russia-access and budget constraints.

        data_sensitivity: public | internal | confidential | personal. prefer: balanced | cost |
        quality | safety. Returns ranked models with monthly cost, pros/cons and excluded count.
        """
        with _user_errors():
            workload = Workload(
                task_type=_enum(TaskType, task_type, "task_type"),
                data_sensitivity=_enum(Sensitivity, data_sensitivity, "data_sensitivity"),
                requests_per_month=requests_per_month,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                min_quality=min_quality,
                monthly_budget_rub=monthly_budget_rub,
                needs_vision=needs_vision,
                needs_tool_calling=needs_tool_calling,
                must_self_host=must_self_host,
                allow_workarounds=allow_workarounds,
                prefer=_enum(Preference, prefer, "prefer"),
            )
            advice = svc.advisor.recommend(workload, top=max(1, top))
        return {
            "recommendations": [
                {
                    "rank": r.rank,
                    "model_id": r.model_id,
                    "name": r.name,
                    "deployment": r.deployment.value,
                    "score": r.score,
                    "monthly_cost_rub": r.cost.total_rub,
                    "requires_masking": r.requires_masking,
                    "pros": r.pros,
                    "cons": r.cons,
                }
                for r in advice.recommendations
            ],
            "excluded": [{"model_id": e.model_id, "reasons": e.reasons} for e in advice.excluded],
            "notes": advice.notes,
            "catalog_as_of": advice.catalog_as_of.isoformat(),
            "data_status": advice.data_status,
        }

    @server.tool()
    def scan_sensitive_data(text: str, declared_sensitivity: str = "internal") -> dict[str, Any]:
        """Find personal data and secrets in text and decide where it may be sent.

        Returns findings with masked previews only (never raw values) and a decision
        (allow | mask | deny) for ru_cloud, foreign_cloud and self_hosted models.
        """
        with _user_errors():
            _check_length(svc, text)
            level = _enum(Sensitivity, declared_sensitivity, "declared_sensitivity")
            payload = svc.guard.analyze(text, level).report.model_dump(mode="json")
        payload.pop("masked_text")
        return payload

    @server.tool()
    def mask_sensitive_data(text: str) -> dict[str, Any]:
        """Replace personal data and secrets with placeholders like [PHONE_1].

        The placeholder-to-value mapping is intentionally NOT returned, so the original values
        never enter the agent context. Use mask_file when you need a reversible mapping on disk.
        """
        with _user_errors():
            _check_length(svc, text)
            masked = svc.guard.mask(text)
        return {"masked_text": masked.text, "counts": masked.counts}

    @server.tool()
    def scan_file(path: str, declared_sensitivity: str = "internal") -> dict[str, Any]:
        """Scan a local text file (inside the allowed root) without exposing its contents."""
        with _user_errors():
            text = _read_inside(svc, base, path)
            level = _enum(Sensitivity, declared_sensitivity, "declared_sensitivity")
            payload = svc.guard.analyze(text, level).report.model_dump(mode="json")
            payload["path"] = str(_inside(base, path).relative_to(base))
        payload.pop("masked_text")
        return payload

    @server.tool()
    def mask_file(
        path: str, output_path: str | None = None, overwrite: bool = False
    ) -> dict[str, Any]:
        """Write a masked copy of a local file plus a private mapping file; return only metadata.

        Output defaults to '<name>.masked<ext>' and '<name>.masked.mapping.json' next to the source.
        """
        with _user_errors():
            source = _inside(base, path)
            text = _read_inside(svc, base, path)
            target = (
                _inside(base, output_path)
                if output_path
                else source.with_name(f"{source.stem}.masked{source.suffix}")
            )
            mapping_file = target.with_name(f"{target.stem}.mapping.json")
            if not overwrite and (target.exists() or mapping_file.exists()):
                raise ValueError("Файл результата уже существует; передайте overwrite=true")
            masked = svc.guard.mask(text)
            target.write_text(masked.text, encoding="utf-8")
            mapping_file.write_text(
                json.dumps(masked.mapping, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            os.chmod(mapping_file, 0o600)
            return {
                "masked_file": str(target.relative_to(base)),
                "mapping_file": str(mapping_file.relative_to(base)),
                "counts": masked.counts,
                "note": "Файл соответствий содержит исходные данные: не передавайте его во внешние сервисы.",
            }

    @server.tool()
    def lint_prompt(text: str) -> dict[str, Any]:
        """Score a prompt (0-100) for role, task, context, format, constraints and safety."""
        with _user_errors():
            _check_length(svc, text)
            return svc.linter.lint(text).model_dump(mode="json")

    @server.tool()
    def list_prompt_templates(department: str | None = None) -> list[dict[str, Any]]:
        """List ready-made prompt templates (id, title, department, task type, variables)."""
        return [
            {
                "id": t.id,
                "title": t.title,
                "department": t.department,
                "task_type": t.task_type.value,
                "sensitivity": t.sensitivity.value,
                "variables": [v.name for v in t.variables if v.required and v.default is None],
            }
            for t in svc.library.list_templates(department=department)
        ]

    @server.tool()
    def render_prompt_template(template_id: str, values: dict[str, str]) -> dict[str, Any]:
        """Fill a prompt template; returns the prompt text, warnings and a quality score."""
        with _user_errors():
            try:
                rendered = svc.library.render(template_id, values)
            except KeyError:
                raise ValueError(f"Шаблон не найден: {template_id}") from None
            return rendered.model_dump(mode="json")

    @server.tool()
    def check_catalog_freshness(max_age_days: int = 90) -> dict[str, Any]:
        """List model-catalog entries not reviewed for more than max_age_days."""
        stale = svc.catalog.stale_entries(svc.settings.current_date, max_age_days)
        return {
            "as_of": svc.catalog.as_of.isoformat(),
            "data_status": svc.catalog.data_status,
            "stale": [s.model_dump(mode="json") for s in stale],
        }

    @server.resource("compass://policy/handout", mime_type="text/markdown")
    def policy_handout() -> str:
        """Employee handout: what data may go to which AI deployment."""
        return svc.policy.handout_markdown()

    return server


def run_stdio() -> None:
    create_mcp_server().run()
