"""Политика обработки данных: матрица «категория данных — размещение модели»."""

from datetime import date
from pathlib import Path
from typing import Self

from pydantic import BaseModel, Field, model_validator

from ..domain import (
    ACTION_LABELS,
    DEPLOYMENT_LABELS,
    SENSITIVITY_LABELS,
    SENSITIVITY_ORDER,
    Action,
    Deployment,
    Sensitivity,
)
from ..resources import load_yaml


class SensitivityClass(BaseModel):
    label: str
    description: str
    examples: list[str] = Field(default_factory=list)


class DeploymentInfo(BaseModel):
    label: str
    description: str


class SecretsRule(BaseModel):
    action: Action = Action.DENY
    message: str


class PolicyDocument(BaseModel):
    version: int = 1
    updated: date
    disclaimer: str = ""
    classes: dict[Sensitivity, SensitivityClass]
    deployments: dict[Deployment, DeploymentInfo]
    actions: dict[Action, str]
    matrix: dict[Sensitivity, dict[Deployment, Action]]
    safety_scores: dict[Sensitivity, dict[Deployment, float]]
    secrets: SecretsRule
    do: list[str] = Field(default_factory=list)
    dont: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _complete_matrix(self) -> Self:
        for table_name, table in (("matrix", self.matrix), ("safety_scores", self.safety_scores)):
            for level in Sensitivity:
                row = table.get(level)
                if row is None or set(row) != set(Deployment):
                    raise ValueError(f"{table_name}: для «{level.value}» нужны все размещения")
        for row_scores in self.safety_scores.values():
            if any(not 0 <= score <= 1 for score in row_scores.values()):
                raise ValueError("safety_scores должны быть в диапазоне 0..1")
        if set(self.classes) != set(Sensitivity):
            raise ValueError("classes: нужны все категории данных")
        return self


_ACTION_ICONS = {Action.ALLOW: "✅", Action.MASK: "🟡", Action.DENY: "⛔"}


class Policy:
    """Запросы к матрице политики и генерация памятки для сотрудников."""

    def __init__(self, document: PolicyDocument) -> None:
        self.document = document

    @classmethod
    def load(cls, data_dir: Path | None = None) -> Self:
        return cls(PolicyDocument.model_validate(load_yaml("policy.yaml", data_dir)))

    def action(self, sensitivity: Sensitivity, deployment: Deployment) -> Action:
        return self.document.matrix[sensitivity][deployment]

    def allowed_deployments(self, sensitivity: Sensitivity) -> list[Deployment]:
        return [d for d in Deployment if self.action(sensitivity, d) is not Action.DENY]

    def safety_score(self, sensitivity: Sensitivity, deployment: Deployment) -> float:
        return self.document.safety_scores[sensitivity][deployment]

    def label(self, sensitivity: Sensitivity) -> str:
        return self.document.classes[sensitivity].label

    def handout_markdown(self) -> str:
        """Памятка «Безопасная работа с нейросетями» — генерируется из той же политики."""
        doc = self.document
        lines: list[str] = [
            "# Памятка: безопасная работа с нейросетями",
            "",
            f"> {doc.disclaimer.strip()}",
            "",
            "## 1. Какие данные у вас в руках",
            "",
            "| Категория | Что это | Примеры |",
            "| --- | --- | --- |",
        ]
        for level in SENSITIVITY_ORDER:
            cls = doc.classes[level]
            examples = "; ".join(cls.examples)
            lines.append(f"| **{cls.label}** | {cls.description.strip()} | {examples} |")

        lines += [
            "",
            "## 2. Куда можно отправлять",
            "",
            "| Категория данных | " + " | ".join(DEPLOYMENT_LABELS[d] for d in Deployment) + " |",
            "| --- | " + " | ".join("---" for _ in Deployment) + " |",
        ]
        for level in SENSITIVITY_ORDER:
            cells = [
                f"{_ACTION_ICONS[self.action(level, d)]} {ACTION_LABELS[self.action(level, d)]}"
                for d in Deployment
            ]
            lines.append(f"| **{SENSITIVITY_LABELS[level]}** | " + " | ".join(cells) + " |")

        lines += ["", "Обозначения:", ""]
        for action in Action:
            lines.append(
                f"- {_ACTION_ICONS[action]} **{ACTION_LABELS[action]}** — {doc.actions[action]}"
            )

        lines += ["", "## 3. Всегда", ""]
        lines += [f"- {item}" for item in doc.do]
        lines += ["", "## 4. Никогда", ""]
        lines += [f"- {item}" for item in doc.dont]
        lines += [
            "",
            "## 5. Если данные отправлены не туда",
            "",
            "1. Сообщите ответственному за информационную безопасность в течение рабочего дня.",
            "2. Если в тексте были ключи или пароли — немедленно перевыпустите их.",
            "3. Зафиксируйте, что и куда было отправлено, чтобы оценить последствия.",
            "4. Не удаляйте историю диалога до разбора инцидента.",
            "",
            f"**Секреты.** {doc.secrets.message.strip()}",
            "",
        ]
        return "\n".join(lines)
