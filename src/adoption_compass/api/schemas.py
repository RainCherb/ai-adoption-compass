"""Схемы запросов и ответов REST API."""

from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from ..assessment import AssessmentResult, Process
from ..csv_io import RowError
from ..domain import Action, Deployment, Sensitivity
from ..evals import EvalReport
from ..safety import SafetyReport

MAX_TEXT = 200_000


class AssumptionsOverride(BaseModel):
    """Любое допущение расчёта можно переопределить; незаданные берутся из scoring.yaml."""

    horizon_months: int | None = Field(None, ge=1, le=60)
    implementation_day_rub: float | None = Field(None, ge=0)
    support_share_per_month: float | None = Field(None, ge=0, le=0.5)
    llm_overhead: float | None = Field(None, ge=1, le=5)
    error_reduction: float | None = Field(None, ge=0, le=1)
    usd_rub: float | None = Field(None, gt=0)
    default_hourly_cost_rub: float | None = Field(None, gt=0)
    impact_scale_rub: float | None = Field(None, gt=0)
    allow_workarounds: bool | None = None
    share_infrastructure: bool | None = None


class AssessmentRequest(BaseModel):
    name: str = Field("Без названия", min_length=1, max_length=120)
    processes: list[Process] = Field(min_length=1, max_length=2000)
    assumptions: AssumptionsOverride | None = None


class StoredAssessmentOut(BaseModel):
    id: str
    name: str
    created_at: str
    processes: list[Process]
    assumptions: dict[str, Any] | None = None
    result: AssessmentResult


class UploadResponse(BaseModel):
    assessment: StoredAssessmentOut
    parse_errors: list[RowError]


class AnalyzeRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT)
    declared_sensitivity: Sensitivity = Sensitivity.INTERNAL
    include_mapping: bool = False


class AnalyzeResponse(SafetyReport):
    mapping: dict[str, str] | None = None


class UnmaskRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT)
    mapping: dict[str, str]


class TextResponse(BaseModel):
    text: str


class LintRequest(BaseModel):
    text: str = Field(max_length=MAX_TEXT)


class ScaffoldRequest(BaseModel):
    task: str = Field(min_length=3, max_length=500)
    role: str | None = Field(None, max_length=120)


class RenderRequest(BaseModel):
    values: dict[str, str] = Field(default_factory=dict)


class CatalogStatus(BaseModel):
    as_of: date
    data_status: str
    stale: int


class HealthResponse(BaseModel):
    status: str
    version: str
    database: bool
    catalog: CatalogStatus


class OptionOut(BaseModel):
    value: str
    label: str
    description: str | None = None


class TaskTypeOut(BaseModel):
    value: str
    label: str
    tokens_in: int
    tokens_out: int
    min_quality: int
    base_automation: float
    implementation_days: float


class SensitivityOut(BaseModel):
    value: str
    label: str
    description: str
    examples: list[str]


class MetaResponse(BaseModel):
    version: str
    task_types: list[TaskTypeOut]
    sensitivities: list[SensitivityOut]
    deployments: list[OptionOut]
    preferences: list[OptionOut]
    quadrants: list[OptionOut]
    actions: list[OptionOut]
    default_assumptions: dict[str, Any]
    thresholds: dict[str, float]
    limits: dict[str, int]
    catalog: dict[str, Any]


class PolicyOut(BaseModel):
    updated: date
    disclaimer: str
    classes: list[SensitivityOut]
    deployments: list[OptionOut]
    actions: list[OptionOut]
    matrix: dict[Sensitivity, dict[Deployment, Action]]
    do: list[str]
    dont: list[str]
    secrets_message: str
    handout_markdown: str


class EvalLabelOut(BaseModel):
    name: str
    title: str


class EvalTaskOut(BaseModel):
    id: str
    title: str
    description: str
    labels: list[EvalLabelOut]
    items: int


class EvalDemoResponse(BaseModel):
    task: EvalTaskOut
    reports: list[EvalReport]
    markdown: str


class EventOut(BaseModel):
    id: int
    ts: str
    kind: str
    payload: dict[str, Any]


class EventsResponse(BaseModel):
    events: list[EventOut]
