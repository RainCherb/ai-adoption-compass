"""Конфигурация скоринга: допущения, сценарии, профили задач."""

from pathlib import Path
from typing import Self

from pydantic import BaseModel, Field, model_validator

from .domain import Sensitivity, TaskType
from .resources import load_yaml


class Assumptions(BaseModel):
    """Допущения расчёта. Любое поле можно переопределить в запросе."""

    horizon_months: int = Field(12, ge=1, le=60)
    implementation_day_rub: float = Field(25_000, ge=0, le=1_000_000_000)
    support_share_per_month: float = Field(0.02, ge=0, le=0.5)
    llm_overhead: float = Field(1.3, ge=1, le=5)
    error_reduction: float = Field(0.25, ge=0, le=1)
    usd_rub: float = Field(90.0, gt=0, le=1_000_000)
    default_hourly_cost_rub: float = Field(800, gt=0, le=1_000_000_000)
    impact_scale_rub: float = Field(500_000, gt=0)
    allow_workarounds: bool = False
    share_infrastructure: bool = True


class TaskProfile(BaseModel):
    base_automation: float = Field(gt=0, le=1)
    review_overhead: float = Field(ge=0, le=1)
    implementation_days: float = Field(gt=0)
    tokens_in: int = Field(gt=0)
    tokens_out: int = Field(ge=0)
    min_quality: int = Field(ge=1, le=5)


class ScenarioFactors(BaseModel):
    label: str
    savings: float = Field(gt=0)
    llm_cost: float = Field(gt=0)
    implementation: float = Field(gt=0)


class Thresholds(BaseModel):
    impact: float = Field(50, ge=0, le=100)
    ease: float = Field(50, ge=0, le=100)


class PriorityWeights(BaseModel):
    impact: float
    ease: float
    fit: float

    @model_validator(mode="after")
    def _sum_to_one(self) -> Self:
        if abs(self.impact + self.ease + self.fit - 1.0) > 1e-6:
            raise ValueError("веса приоритета должны давать в сумме 1")
        return self


class Complexity(BaseModel):
    digital_readiness: dict[int, float]
    risk: dict[int, float]
    sensitivity: dict[Sensitivity, float]


class ScoringConfig(BaseModel):
    version: int = 1
    assumptions: Assumptions
    scenarios: dict[str, ScenarioFactors]
    thresholds: Thresholds
    priority_weights: PriorityWeights
    complexity: Complexity
    task_types: dict[TaskType, TaskProfile]

    @model_validator(mode="after")
    def _complete(self) -> Self:
        missing = set(TaskType) - set(self.task_types)
        if missing:
            raise ValueError(f"нет профилей задач: {sorted(t.value for t in missing)}")
        if "base" not in self.scenarios:
            raise ValueError("нужен сценарий «base»")
        for level in range(1, 6):
            if level not in self.complexity.digital_readiness or level not in self.complexity.risk:
                raise ValueError("множители сложности нужны для уровней 1–5")
        if set(self.complexity.sensitivity) != set(Sensitivity):
            raise ValueError("множители сложности нужны для всех категорий данных")
        return self


def load_scoring(data_dir: Path | None = None) -> ScoringConfig:
    return ScoringConfig.model_validate(load_yaml("scoring.yaml", data_dir))
