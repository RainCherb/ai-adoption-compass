"""Задача оценки качества: категории, промпты и золотой набор."""

import json
import re
from pathlib import Path

from pydantic import BaseModel, Field, model_validator

from ..resources import load_yaml, read_data_text

_JSON_OBJECT = re.compile(r"\{[^{}]*\}")


class LabelSpec(BaseModel):
    title: str
    keywords: list[str] = Field(default_factory=list)


class EvalTask(BaseModel):
    id: str
    title: str
    description: str
    fallback_label: str
    labels: dict[str, LabelSpec]

    @model_validator(mode="after")
    def _fallback_exists(self) -> "EvalTask":
        if self.fallback_label not in self.labels:
            raise ValueError("fallback_label должен быть одной из категорий")
        return self

    @property
    def label_names(self) -> list[str]:
        return list(self.labels)

    def system_prompt(self) -> str:
        lines = [
            "Ты — диспетчер службы поддержки. Твоя задача — отнести обращение клиента "
            "ровно к одной категории.",
            "Категории:",
        ]
        lines += [f"- {name} — {spec.title}" for name, spec in self.labels.items()]
        lines += [
            'Ответ — только JSON вида {"label": "<код категории>"} без пояснений.',
            f'Если не уверен, выбери "{self.fallback_label}".',
        ]
        return "\n".join(lines)

    @staticmethod
    def user_prompt(text: str) -> str:
        return f"Обращение:\n<ticket>\n{text}\n</ticket>"

    def extract_label(self, raw: str) -> str | None:
        """Достать код категории из ответа модели: JSON или единственное упоминание кода."""
        for candidate in _JSON_OBJECT.findall(raw):
            try:
                value = json.loads(candidate).get("label")
            except (json.JSONDecodeError, AttributeError):
                continue
            if isinstance(value, str) and value.strip() in self.labels:
                return value.strip()
        mentioned = {
            name
            for name in self.labels
            if re.search(rf"(?<![\w-]){re.escape(name)}(?![\w-])", raw, re.IGNORECASE)
        }
        if len(mentioned) == 1:
            return next(iter(mentioned)).lower()
        return None


class EvalItem(BaseModel):
    id: str
    text: str
    label: str


def load_task(data_dir: Path | None = None) -> EvalTask:
    return EvalTask.model_validate(load_yaml("evals/routing.yaml", data_dir))


def parse_items(content: str, task: EvalTask) -> list[EvalItem]:
    """Разобрать JSONL: по строке на объект {id, text, label}."""
    items: list[EvalItem] = []
    for number, line in enumerate(content.splitlines(), start=1):
        if not line.strip():
            continue
        try:
            item = EvalItem.model_validate_json(line)
        except ValueError as exc:
            raise ValueError(f"Строка {number}: {exc}") from exc
        if item.label not in task.labels:
            raise ValueError(f"Строка {number}: неизвестная категория «{item.label}»")
        items.append(item)
    if not items:
        raise ValueError("Набор данных пуст")
    return items


def load_items(task: EvalTask, data_dir: Path | None = None) -> list[EvalItem]:
    return parse_items(read_data_text("evals/routing.jsonl", data_dir), task)
