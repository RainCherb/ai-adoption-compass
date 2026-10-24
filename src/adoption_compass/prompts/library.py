"""Библиотека шаблонов запросов: загрузка, проверка и безопасный рендеринг."""

from collections.abc import Mapping
from pathlib import Path
from typing import Literal

from jinja2 import StrictUndefined, TemplateError, meta
from jinja2.sandbox import SandboxedEnvironment
from pydantic import BaseModel, Field

from ..domain import Sensitivity, TaskType
from ..resources import load_yaml
from ..safety import SafetyGuard
from .linter import PromptLinter

MAX_VALUE_CHARS = 50_000


class PromptRenderError(ValueError):
    """Значения не подходят шаблону; errors содержит список понятных пользователю причин."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


class PromptVariable(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    label: str
    type: Literal["string", "text", "choice"] = "string"
    required: bool = True
    default: str | None = None
    choices: list[str] | None = None
    example: str | None = None


class PromptTemplate(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    title: str
    department: str
    task_type: TaskType
    sensitivity: Sensitivity
    description: str
    variables: list[PromptVariable]
    body: str
    checklist: list[str] = Field(default_factory=list)
    safety_notes: list[str] = Field(default_factory=list)


class PromptDocument(BaseModel):
    version: int = 1
    templates: list[PromptTemplate]


class RenderedPrompt(BaseModel):
    template_id: str
    title: str
    text: str
    warnings: list[str]
    sensitive: dict[str, int]
    lint_score: int
    recommended_sensitivity: Sensitivity
    checklist: list[str]
    safety_notes: list[str]


class PromptLibrary:
    def __init__(self, document: PromptDocument, guard: SafetyGuard, linter: PromptLinter) -> None:
        self.guard = guard
        self.linter = linter
        self._env = SandboxedEnvironment(
            undefined=StrictUndefined,
            autoescape=False,
            trim_blocks=True,
            lstrip_blocks=True,
        )
        self.templates: dict[str, PromptTemplate] = {}
        self._compiled = {}
        for template in document.templates:
            if template.id in self.templates:
                raise ValueError(f"Повторяющийся id шаблона: {template.id}")
            used = meta.find_undeclared_variables(self._env.parse(template.body))
            declared = {v.name for v in template.variables}
            if used - declared:
                raise ValueError(f"Шаблон {template.id}: не объявлены {sorted(used - declared)}")
            if declared - used:
                raise ValueError(f"Шаблон {template.id}: не используются {sorted(declared - used)}")
            self.templates[template.id] = template
            self._compiled[template.id] = self._env.from_string(template.body)

    @classmethod
    def load(
        cls, guard: SafetyGuard, linter: PromptLinter, data_dir: Path | None = None
    ) -> "PromptLibrary":
        document = PromptDocument.model_validate(load_yaml("prompts.yaml", data_dir))
        return cls(document, guard, linter)

    def list_templates(
        self, *, department: str | None = None, task_type: TaskType | str | None = None
    ) -> list[PromptTemplate]:
        return [
            t
            for t in self.templates.values()
            if (department is None or t.department.lower() == department.lower())
            and (task_type is None or t.task_type == task_type)
        ]

    def departments(self) -> list[str]:
        return sorted({t.department for t in self.templates.values()})

    def get(self, template_id: str) -> PromptTemplate:
        try:
            return self.templates[template_id]
        except KeyError:
            raise KeyError(template_id) from None

    def render(self, template_id: str, values: Mapping[str, str]) -> RenderedPrompt:
        template = self.get(template_id)
        final: dict[str, str] = {}
        errors: list[str] = []
        known = {v.name for v in template.variables}
        unknown = sorted(set(values) - known)
        if unknown:
            errors.append(f"Неизвестные поля: {', '.join(unknown)}")
        for var in template.variables:
            raw = values.get(var.name)
            if raw is None or not str(raw).strip():
                if var.default is not None:
                    raw = var.default
                elif var.required:
                    errors.append(f"Не заполнено поле «{var.label}»")
                    continue
                else:
                    raw = ""
            value = str(raw)
            if len(value) > MAX_VALUE_CHARS:
                errors.append(
                    f"Поле «{var.label}» слишком длинное (максимум {MAX_VALUE_CHARS} символов)"
                )
                continue
            if var.type == "choice" and var.choices and value not in var.choices:
                errors.append(f"Поле «{var.label}»: допустимо {', '.join(var.choices)}")
                continue
            final[var.name] = value
        if errors:
            raise PromptRenderError(errors)

        try:
            text = self._compiled[template.id].render(**final).strip()
        except TemplateError as exc:  # pragma: no cover - шаблоны проверены при загрузке
            raise PromptRenderError([f"Ошибка шаблона: {exc}"]) from exc

        findings = self.guard.scan("\n".join(final.values()))
        sensitive: dict[str, int] = {}
        for finding in findings:
            sensitive[finding.kind] = sensitive.get(finding.kind, 0) + 1
        warnings: list[str] = []
        if any(f.is_secret for f in findings):
            warnings.append("В значениях есть секреты (ключи, пароли): удалите их перед отправкой.")
        elif findings:
            warnings.append(
                "В значениях найдены персональные данные: обезличьте их или используйте "
                "российскую модель / свой контур."
            )
        return RenderedPrompt(
            template_id=template.id,
            title=template.title,
            text=text,
            warnings=warnings,
            sensitive=sensitive,
            lint_score=self.linter.lint(text).score,
            recommended_sensitivity=template.sensitivity,
            checklist=template.checklist,
            safety_notes=template.safety_notes,
        )
