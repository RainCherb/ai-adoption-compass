"""Советник по выбору моделей: жёсткие ограничения, оценка стоимости, объяснимое ранжирование."""

import math
from datetime import date
from enum import StrEnum

from pydantic import BaseModel, Field

from .catalog import Catalog, ModelEntry
from .domain import (
    DEPLOYMENT_LABELS,
    SENSITIVITY_LABELS,
    TASK_LABELS,
    Action,
    Deployment,
    RuAccess,
    Sensitivity,
    TaskType,
    Tier,
    format_rub,
)
from .safety.policy import Policy


class Preference(StrEnum):
    BALANCED = "balanced"
    COST = "cost"
    QUALITY = "quality"
    SAFETY = "safety"


WEIGHTS: dict[Preference, dict[str, float]] = {
    Preference.BALANCED: {"quality": 0.40, "cost": 0.25, "safety": 0.20, "access": 0.15},
    Preference.COST: {"quality": 0.25, "cost": 0.50, "safety": 0.15, "access": 0.10},
    Preference.QUALITY: {"quality": 0.60, "cost": 0.10, "safety": 0.15, "access": 0.15},
    Preference.SAFETY: {"quality": 0.25, "cost": 0.10, "safety": 0.50, "access": 0.15},
}

ACCESS_SCORES: dict[RuAccess, float] = {RuAccess.DIRECT: 1.0, RuAccess.WORKAROUND: 0.3}

# Вес качества сверх требуемого порога: «достаточно хорошо» ценится меньше, чем сам порог.
SURPLUS_WEIGHT: dict[Preference, float] = {
    Preference.BALANCED: 0.5,
    Preference.COST: 0.25,
    Preference.QUALITY: 1.0,
    Preference.SAFETY: 0.5,
}

# Подсказки «что ослабить»; политику данных не ослабляем ни при каких условиях.
RELAX_HINTS: dict[str, str] = {
    "quality": "Снизьте требуемое качество",
    "budget": "Увеличьте бюджет",
    "access": "Разрешите обходные пути доступа (с учётом рисков)",
    "foreign": "Разрешите зарубежные облака",
    "self_host": "Не требуйте self-hosted",
    "vision": "Откажитесь от работы с изображениями",
    "tools": "Откажитесь от вызова функций",
    "context": "Уменьшите требуемый контекст",
}


class Workload(BaseModel):
    """Описание нагрузки, под которую подбирается модель."""

    task_type: TaskType
    data_sensitivity: Sensitivity = Sensitivity.INTERNAL
    requests_per_month: int = Field(gt=0, le=1_000_000_000)
    tokens_in: int = Field(gt=0, le=2_000_000, description="среднее число входных токенов")
    tokens_out: int = Field(ge=0, le=2_000_000, description="среднее число выходных токенов")
    min_quality: int = Field(3, ge=1, le=5)
    monthly_budget_rub: float | None = Field(None, gt=0, le=1_000_000_000_000_000)
    needs_vision: bool = False
    needs_tool_calling: bool = False
    min_context_tokens: int | None = Field(None, gt=0)
    must_self_host: bool = False
    allow_foreign_cloud: bool = True
    allow_workarounds: bool = False
    prefer: Preference = Preference.BALANCED


class CostBreakdown(BaseModel):
    variable_rub: float
    fixed_rub: float
    total_rub: float
    units: int = 1


class ScoreBreakdown(BaseModel):
    quality: float
    cost: float
    safety: float
    access: float


class Recommendation(BaseModel):
    rank: int
    model_id: str
    name: str
    vendor: str
    tier: Tier
    deployment: Deployment
    ru_access: RuAccess
    score: float
    quality: int
    cost: CostBreakdown
    breakdown: ScoreBreakdown
    requires_masking: bool
    pros: list[str]
    cons: list[str]


class Exclusion(BaseModel):
    model_id: str
    name: str
    deployment: Deployment
    reasons: list[str]
    kinds: list[str]


class AdviceResult(BaseModel):
    workload: Workload
    recommendations: list[Recommendation]
    excluded: list[Exclusion]
    notes: list[str]
    catalog_as_of: date
    data_status: str
    usd_rub: float


def _cost_scores(totals: list[float]) -> list[float]:
    """Логарифмическая шкала: самая дешёвая модель получает 1, самая дорогая — 0."""
    values = [max(total, 1.0) for total in totals]
    low, high = min(values), max(values)
    if high - low < 1e-9:
        return [1.0] * len(values)
    span = math.log(high) - math.log(low)
    return [1.0 - (math.log(value) - math.log(low)) / span for value in values]


def _tokens(value: int) -> str:
    return f"{value:,}".replace(",", "\u00a0")


class Advisor:
    def __init__(
        self,
        catalog: Catalog,
        policy: Policy,
        *,
        usd_rub: float = 90.0,
        today: date | None = None,
    ) -> None:
        self.catalog = catalog
        self.policy = policy
        self.usd_rub = usd_rub
        self.today = today or date.today()

    def to_rub(self, amount: float, currency: str) -> float:
        return amount * self.usd_rub if currency == "USD" else amount

    def estimate_cost(
        self,
        model: ModelEntry,
        requests: int,
        tokens_in: int,
        tokens_out: int,
        *,
        overhead: float = 1.0,
        fixed_override: float | None = None,
    ) -> CostBreakdown:
        """Месячная стоимость: токены + аренда инфраструктуры (с учётом её ёмкости)."""
        mtok_in = requests * tokens_in * overhead / 1_000_000
        mtok_out = requests * tokens_out * overhead / 1_000_000
        pricing = model.pricing
        variable = self.to_rub(
            mtok_in * pricing.input_per_mtok + mtok_out * pricing.output_per_mtok,
            pricing.currency,
        )
        units = 1
        fixed = 0.0
        if pricing.fixed_monthly > 0 and pricing.capacity_mtok_month:
            units = max(1, math.ceil((mtok_in + mtok_out) / pricing.capacity_mtok_month))
            fixed = self.to_rub(pricing.fixed_monthly, pricing.currency) * units
        if fixed_override is not None:
            fixed = fixed_override
        return CostBreakdown(
            variable_rub=round(variable, 2),
            fixed_rub=round(fixed, 2),
            total_rub=round(variable + fixed, 2),
            units=units,
        )

    def _blocking_reasons(self, model: ModelEntry, w: Workload) -> list[tuple[str, str]]:
        """Жёсткие причины исключения в виде пар (вид, текст)."""
        reasons: list[tuple[str, str]] = []
        sens = SENSITIVITY_LABELS[w.data_sensitivity].lower()
        if self.policy.action(w.data_sensitivity, model.deployment) is Action.DENY:
            reasons.append(
                (
                    "policy",
                    f"Политика данных: для категории «{sens}» размещение "
                    f"«{DEPLOYMENT_LABELS[model.deployment]}» запрещено",
                )
            )
        if model.deployment is Deployment.FOREIGN_CLOUD and not w.allow_foreign_cloud:
            reasons.append(("foreign", "Зарубежные облака исключены ограничением заказчика"))
        if w.must_self_host and model.deployment is not Deployment.SELF_HOSTED:
            reasons.append(
                ("self_host", "Требуется self-hosted решение: данные не должны покидать контур")
            )
        if model.ru_access is RuAccess.WORKAROUND and not w.allow_workarounds:
            reasons.append(
                (
                    "access",
                    "Доступ из РФ только через обходные пути (посредники, зарубежная оплата): "
                    "риски блокировок и нарушения условий использования",
                )
            )
        if w.needs_vision and not model.vision:
            reasons.append(("vision", "Нет поддержки изображений"))
        if w.needs_tool_calling and not model.tool_calling:
            reasons.append(("tools", "Нет вызова функций (tool calling)"))
        if w.min_context_tokens and model.context_window < w.min_context_tokens:
            reasons.append(
                (
                    "context",
                    f"Контекстное окно {_tokens(model.context_window)} токенов меньше требуемых "
                    f"{_tokens(w.min_context_tokens)}",
                )
            )
        quality = model.quality[w.task_type]
        if quality < w.min_quality:
            reasons.append(
                (
                    "quality",
                    f"Оценка качества {quality}/5 для задачи «{TASK_LABELS[w.task_type]}» "
                    f"ниже требуемой {w.min_quality}/5",
                )
            )
        return reasons

    def _explain(
        self,
        model: ModelEntry,
        w: Workload,
        cost: CostBreakdown,
        action: Action,
        *,
        cheapest: bool,
    ) -> tuple[list[str], list[str]]:
        quality = model.quality[w.task_type]
        pros = [f"Оценка качества для задачи «{TASK_LABELS[w.task_type]}»: {quality}/5"]
        cons: list[str] = []
        if model.deployment is Deployment.SELF_HOSTED:
            pros.append("Данные не покидают ваш контур")
        elif model.deployment is Deployment.RU_CLOUD:
            pros.append(
                "Обработка в РФ: проще выполнить требования о локализации персональных данных"
            )
        if model.ru_access is RuAccess.DIRECT and model.deployment is not Deployment.SELF_HOSTED:
            pros.append("Доступна из РФ напрямую, оплата в рублях")
        if cheapest:
            pros.append("Самая низкая стоимость среди подходящих моделей")
        if model.context_window >= 200_000:
            pros.append(f"Большое контекстное окно: {_tokens(model.context_window)} токенов")
        if action is Action.MASK:
            cons.append(
                "Перед отправкой данные нужно обезличивать (замена идентификаторов метками)"
            )
        if model.ru_access is RuAccess.WORKAROUND:
            cons.append(
                "Доступ из РФ только через обходные пути: риски блокировок и условий использования"
            )
        if cost.fixed_rub > 0:
            cons.append(
                f"Фиксированные расходы на инфраструктуру: {format_rub(cost.fixed_rub)}/мес "
                f"(блоков: {cost.units})"
            )
        if quality == w.min_quality:
            cons.append("Качество на пороге требований — проверьте на своих данных (compass eval)")
        return pros, cons

    def recommend(self, workload: Workload, *, top: int = 5) -> AdviceResult:
        eligible: list[tuple[ModelEntry, CostBreakdown, Action]] = []
        excluded: list[Exclusion] = []
        for model in self.catalog.models:
            cost = self.estimate_cost(
                model, workload.requests_per_month, workload.tokens_in, workload.tokens_out
            )
            reasons = self._blocking_reasons(model, workload)
            budget = workload.monthly_budget_rub
            if budget is not None and cost.total_rub > budget:
                reasons.append(
                    (
                        "budget",
                        f"Стоимость {format_rub(cost.total_rub)}/мес превышает бюджет "
                        f"{format_rub(budget)}/мес",
                    )
                )
            if reasons:
                excluded.append(
                    Exclusion(
                        model_id=model.id,
                        name=model.name,
                        deployment=model.deployment,
                        reasons=[text for _, text in reasons],
                        kinds=[kind for kind, _ in reasons],
                    )
                )
            else:
                action = self.policy.action(workload.data_sensitivity, model.deployment)
                eligible.append((model, cost, action))

        recommendations = self._rank(eligible, workload)[:top]
        return AdviceResult(
            workload=workload,
            recommendations=recommendations,
            excluded=excluded,
            notes=self._notes(recommendations, excluded),
            catalog_as_of=self.catalog.as_of,
            data_status=self.catalog.data_status,
            usd_rub=self.usd_rub,
        )

    def _rank(
        self,
        eligible: list[tuple[ModelEntry, CostBreakdown, Action]],
        w: Workload,
    ) -> list[Recommendation]:
        if not eligible:
            return []
        weights = WEIGHTS[w.prefer]
        cost_scores = _cost_scores([cost.total_rub for _, cost, _ in eligible])
        cheapest = min(cost.total_rub for _, cost, _ in eligible)
        scored: list[Recommendation] = []
        for (model, cost, action), cost_score in zip(eligible, cost_scores, strict=True):
            quality = model.quality[w.task_type]
            effective = min(quality, w.min_quality) + SURPLUS_WEIGHT[w.prefer] * max(
                0, quality - w.min_quality
            )
            breakdown = ScoreBreakdown(
                quality=round((effective - 1) / 4, 3),
                cost=round(cost_score, 3),
                safety=self.policy.safety_score(w.data_sensitivity, model.deployment),
                access=ACCESS_SCORES[model.ru_access],
            )
            score = 100 * sum(weights[key] * getattr(breakdown, key) for key in weights)
            pros, cons = self._explain(
                model, w, cost, action, cheapest=cost.total_rub == cheapest and len(eligible) > 1
            )
            scored.append(
                Recommendation(
                    rank=0,
                    model_id=model.id,
                    name=model.name,
                    vendor=model.vendor,
                    tier=model.tier,
                    deployment=model.deployment,
                    ru_access=model.ru_access,
                    score=round(score, 1),
                    quality=model.quality[w.task_type],
                    cost=cost,
                    breakdown=breakdown,
                    requires_masking=action is Action.MASK,
                    pros=pros,
                    cons=cons,
                )
            )
        scored.sort(key=lambda r: (-r.score, r.cost.total_rub, r.model_id))
        return [r.model_copy(update={"rank": index}) for index, r in enumerate(scored, start=1)]

    def _notes(self, recommendations: list[Recommendation], excluded: list[Exclusion]) -> list[str]:
        notes: list[str] = []
        if self.catalog.data_status == "illustrative":
            notes.append(
                "Данные каталога демонстрационные: перед решением сверьте тарифы и условия "
                "с официальными страницами провайдеров."
            )
        stale = self.catalog.stale_entries(self.today)
        if stale:
            notes.append(
                f"Давно не проверялись записи каталога: {len(stale)} шт. (compass catalog check)."
            )
        if recommendations:
            best = recommendations[0]
            if best.requires_masking:
                notes.append(
                    "Для выбранной категории данных текст нужно обезличивать перед отправкой "
                    "(compass mask или раздел «Безопасность» в дашборде)."
                )
            cheaper = min(recommendations, key=lambda r: r.cost.total_rub)
            if cheaper.model_id != best.model_id and best.cost.total_rub > 0:
                saving = 1 - cheaper.cost.total_rub / best.cost.total_rub
                if saving >= 0.2:
                    notes.append(
                        f"«{cheaper.name}» дешевле лидера на {saving:.0%} при оценке качества "
                        f"{cheaper.quality}/5 против {best.quality}/5 — сравните на своих данных."
                    )
            return notes

        single: dict[str, list[str]] = {}
        for exclusion in excluded:
            kinds = set(exclusion.kinds)
            if len(kinds) == 1:
                single.setdefault(next(iter(kinds)), []).append(exclusion.name)
        notes.append("Подходящих моделей нет: ни одна не проходит все ограничения.")
        hints = [
            f"{RELAX_HINTS[kind]} — подойдут: {', '.join(names[:3])}."
            for kind, names in sorted(single.items(), key=lambda item: (-len(item[1]), item[0]))
            if kind in RELAX_HINTS
        ]
        notes.extend(hints)
        if not hints:
            notes.append(
                "Ни одно ограничение по отдельности не решает задачу: пересмотрите требования "
                "или рассмотрите self-hosted решение."
            )
        return notes
