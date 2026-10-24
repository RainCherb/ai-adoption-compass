"""Каталог моделей: схема данных, загрузка и проверка актуальности."""

from datetime import date
from pathlib import Path
from typing import Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

from .domain import Deployment, RuAccess, TaskType, Tier
from .resources import load_yaml


class Pricing(BaseModel):
    """Стоимость: токены и (для self-hosted) фиксированная аренда инфраструктуры."""

    currency: Literal["RUB", "USD"]
    input_per_mtok: float = Field(ge=0, description="за 1 млн входных токенов")
    output_per_mtok: float = Field(ge=0, description="за 1 млн выходных токенов")
    fixed_monthly: float = Field(0, ge=0, description="фиксированные расходы в месяц")
    capacity_mtok_month: float | None = Field(
        None, gt=0, description="сколько млн токенов в месяц выдерживает один «блок» инфраструктуры"
    )

    @model_validator(mode="after")
    def _fixed_needs_capacity(self) -> Self:
        if self.fixed_monthly > 0 and self.capacity_mtok_month is None:
            raise ValueError("при fixed_monthly > 0 укажите capacity_mtok_month")
        return self


class ModelEntry(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str
    vendor: str
    family: str
    tier: Tier
    deployment: Deployment
    origin: str
    ru_access: RuAccess
    pricing: Pricing
    context_window: int = Field(gt=0)
    vision: bool = False
    tool_calling: bool = True
    quality: dict[TaskType, int]
    strengths: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    pricing_url: str | None = None
    reviewed_at: date
    notes: str | None = None

    @field_validator("quality")
    @classmethod
    def _quality_complete(cls, value: dict[TaskType, int]) -> dict[TaskType, int]:
        missing = sorted(t.value for t in set(TaskType) - set(value))
        if missing:
            raise ValueError(f"нет оценок качества для: {', '.join(missing)}")
        out_of_range = {t.value: q for t, q in value.items() if not 1 <= q <= 5}
        if out_of_range:
            raise ValueError(f"оценки качества должны быть от 1 до 5: {out_of_range}")
        return value


class StaleEntry(BaseModel):
    id: str
    name: str
    reviewed_at: date
    age_days: int


class Catalog(BaseModel):
    version: int = 1
    as_of: date
    data_status: Literal["illustrative", "verified"] = "illustrative"
    disclaimer: str = ""
    models: list[ModelEntry]

    @model_validator(mode="after")
    def _unique_ids(self) -> Self:
        seen: set[str] = set()
        for model in self.models:
            if model.id in seen:
                raise ValueError(f"повторяющийся id модели: {model.id}")
            seen.add(model.id)
        return self

    def get(self, model_id: str) -> ModelEntry:
        for model in self.models:
            if model.id == model_id:
                return model
        raise KeyError(model_id)

    def stale_entries(self, today: date, max_age_days: int = 90) -> list[StaleEntry]:
        """Записи, которые не проверялись дольше max_age_days (самые старые — первыми)."""
        stale = [
            StaleEntry(
                id=m.id,
                name=m.name,
                reviewed_at=m.reviewed_at,
                age_days=(today - m.reviewed_at).days,
            )
            for m in self.models
            if (today - m.reviewed_at).days > max_age_days
        ]
        return sorted(stale, key=lambda s: (-s.age_days, s.id))


def load_catalog(data_dir: Path | None = None) -> Catalog:
    return Catalog.model_validate(load_yaml("catalog.yaml", data_dir))
