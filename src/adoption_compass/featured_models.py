"""Прямые тарифы основных моделей и расчёт одной нагрузки без вызова LLM."""

from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .catalog_sources import source_status
from .resources import load_yaml

Rate = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class DirectPricing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_per_mtok: Rate
    output_per_mtok: Rate
    cached_input_per_mtok: Rate
    off_peak_input_per_mtok: Rate | None = None
    off_peak_output_per_mtok: Rate | None = None
    off_peak_cached_input_per_mtok: Rate | None = None
    long_context_threshold: int | None = Field(None, gt=0)
    long_input_multiplier: float = Field(1, ge=1, allow_inf_nan=False)
    long_output_multiplier: float = Field(1, ge=1, allow_inf_nan=False)

    @model_validator(mode="after")
    def _complete_period(self) -> Self:
        optional = (
            self.off_peak_input_per_mtok,
            self.off_peak_output_per_mtok,
            self.off_peak_cached_input_per_mtok,
        )
        if any(v is None for v in optional) and not all(v is None for v in optional):
            raise ValueError("укажите все три off-peak тарифа")
        return self


class FeaturedModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    vendor: str
    api_model: str
    version_note: str
    summary: str
    context_label: str
    context_tokens: int = Field(gt=0)
    max_output_tokens: int = Field(gt=0)
    pricing: DirectPricing
    pricing_source_id: str
    specs_source_id: str
    source_hashes: dict[str, str] = Field(default_factory=dict)
    pricing_url: str
    specs_url: str
    access_url: str | None = None
    access_note: str
    russia_api_status: Literal["available", "unavailable", "unverified"] = "unverified"
    russia_api_note: str = "Региональная доступность API не подтверждена"
    access_reviewed_at: date | None = None
    best_for: list[str] = Field(default_factory=list)
    conditions: list[str]
    reviewed_at: date
    quality_status: Literal["not_measured"] = "not_measured"


class FeaturedCatalog(BaseModel):
    version: Literal[1] = 1
    currency: Literal["USD"] = "USD"
    disclaimer: str
    models: list[FeaturedModel] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self) -> Self:
        if len({m.id for m in self.models}) != len(self.models):
            raise ValueError("повторяющаяся основная модель")
        return self


class ModelComparisonRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requests_per_month: int = Field(10_000, ge=1, le=1_000_000_000, strict=True)
    tokens_in: int = Field(1000, ge=1, le=2_000_000, strict=True)
    tokens_out: int = Field(300, ge=0, le=384_000, strict=True)
    deepseek_period: Literal["peak", "off_peak"] = "peak"


class ModelCostLine(BaseModel):
    model: FeaturedModel
    available: bool
    reason: str | None = None
    tariff: str
    input_rate: float | None = None
    output_rate: float | None = None
    input_usd: float | None = None
    output_usd: float | None = None
    monthly_usd: float | None = None
    per_request_usd: float | None = None


class ModelComparison(BaseModel):
    workload: ModelComparisonRequest
    currency: Literal["USD"] = "USD"
    disclaimer: str
    models: list[ModelCostLine]


def load_featured(data_dir: Path | None = None) -> FeaturedCatalog:
    return FeaturedCatalog.model_validate(load_yaml("featured-models.yaml", data_dir))


def pricing_rates(
    prices: DirectPricing, tokens_in: int, period: str = "peak"
) -> tuple[float, float, str]:
    input_rate, output_rate = prices.input_per_mtok, prices.output_per_mtok
    tariff = "Standard, без кэша"
    if prices.off_peak_input_per_mtok is not None:
        tariff = "Off-peak, без кэша" if period == "off_peak" else "Peak, без кэша"
        if period == "off_peak":
            input_rate = prices.off_peak_input_per_mtok
            output_rate = prices.off_peak_output_per_mtok or 0.0
    if prices.long_context_threshold and tokens_in > prices.long_context_threshold:
        input_rate *= prices.long_input_multiplier
        output_rate *= prices.long_output_multiplier
        tariff += " · длинный контекст"
    return input_rate, output_rate, tariff


def profile_is_reviewed(model: FeaturedModel, sources: dict[str, Any]) -> bool:
    for source_id, expected_url in (
        (model.pricing_source_id, model.pricing_url),
        (model.specs_source_id, model.specs_url),
    ):
        source = sources.get(source_id)
        if (
            source is None
            or source["url"] != expected_url
            or source["stale"]
            or source["snapshot"]["status"] != "reviewed"
            or source["snapshot"]["reviewed_at"] is None
            or not source["snapshot"]["reviewed_by"]
            or source["snapshot"]["content_sha256"] != model.source_hashes.get(source_id)
            or model.reviewed_at != date.fromisoformat(source["snapshot"]["reviewed_at"][:10])
        ):
            return False
    return True


def compare_models(
    workload: ModelComparisonRequest, today: date, data_dir: Path | None = None
) -> ModelComparison:
    catalog = load_featured(data_dir)
    sources = {s["id"]: s for s in source_status(today, data_dir)["sources"]}
    lines = []
    for model in catalog.models:
        in_rate, out_rate, tariff = pricing_rates(
            model.pricing, workload.tokens_in, workload.deepseek_period
        )
        reason = (
            None
            if profile_is_reviewed(model, sources)
            else "Источник требует повторного ревью; расчёт скрыт"
        )
        if workload.tokens_out > model.max_output_tokens:
            reason = "Превышен максимальный выход модели"
        if workload.tokens_in + workload.tokens_out > model.context_tokens:
            reason = "Вход и выход превышают консервативный предел контекста"
        line = ModelCostLine(model=model, available=reason is None, reason=reason, tariff=tariff)
        if reason is None:
            input_cost = Decimal(workload.tokens_in) * Decimal(str(in_rate)) / 1_000_000
            output_cost = Decimal(workload.tokens_out) * Decimal(str(out_rate)) / 1_000_000
            line.input_rate, line.output_rate = in_rate, out_rate
            line.input_usd = float(input_cost * workload.requests_per_month)
            line.output_usd = float(output_cost * workload.requests_per_month)
            line.monthly_usd = float((input_cost + output_cost) * workload.requests_per_month)
            line.per_request_usd = float(input_cost + output_cost)
        lines.append(line)
    return ModelComparison(workload=workload, disclaimer=catalog.disclaimer, models=lines)
