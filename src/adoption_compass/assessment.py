"""Оценка процессов: пригодность для ИИ, экономика (ROI), приоритизация и дорожная карта."""

import math
from collections import defaultdict
from collections.abc import Sequence
from datetime import date
from typing import Any

from pydantic import BaseModel, Field

from .advisor import Advisor, CostBreakdown, ModelOption, Preference, Recommendation, Workload
from .domain import (
    Deployment,
    Quadrant,
    Sensitivity,
    Severity,
    TaskType,
    format_rub,
)
from .scoring import Assumptions, ScenarioFactors, ScoringConfig

HOURS_PER_FTE = 160.0
MAX_IMPLEMENTATION_DAYS = 60.0
WAVE_TITLES = {
    1: "Волна 1 — быстрые победы",
    2: "Волна 2 — стратегические проекты",
    3: "Волна 3 — попутные задачи",
}
QUADRANT_WAVE = {Quadrant.QUICK_WIN: 1, Quadrant.STRATEGIC: 2, Quadrant.FILL_IN: 3}


class Process(BaseModel):
    """Один бизнес-процесс, который рассматривается как кандидат на автоматизацию."""

    id: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    department: str = Field("—", max_length=100)
    task_type: TaskType
    runs_per_month: int = Field(gt=0, le=100_000_000)
    minutes_per_run: float = Field(gt=0, le=100_000)
    hourly_cost_rub: float | None = Field(None, gt=0, le=1_000_000_000)
    error_rate: float = Field(0.05, ge=0, le=1)
    error_cost_rub: float = Field(0, ge=0, le=1_000_000_000_000)
    standardization: int = Field(3, ge=1, le=5)
    digital_readiness: int = Field(3, ge=1, le=5)
    risk_level: int = Field(2, ge=1, le=5)
    data_sensitivity: Sensitivity = Sensitivity.INTERNAL
    must_self_host: bool = False
    tokens_in: int | None = Field(None, gt=0, le=2_000_000)
    tokens_out: int | None = Field(None, ge=0, le=2_000_000)


class ModelPick(BaseModel):
    model_id: str
    name: str
    deployment: Deployment
    requires_masking: bool
    quality: int
    score: float
    cost: CostBreakdown


class Flag(BaseModel):
    code: str
    severity: Severity
    message: str


class ScenarioResult(BaseModel):
    key: str
    label: str
    net_rub_month: float
    payback_months: float | None
    net_horizon_rub: float
    roi_pct: float


class ProcessResult(BaseModel):
    rank: int
    id: str
    name: str
    department: str
    task_type: TaskType
    data_sensitivity: Sensitivity
    feasible: bool
    hours_per_month: float
    manual_cost_month_rub: float
    automation_share: float
    net_share: float
    hours_saved_month: float
    savings_month_rub: float
    error_savings_month_rub: float
    llm_cost_month_rub: float
    support_month_rub: float
    implementation_days: float
    implementation_rub: float
    net_month_rub: float
    payback_months: float | None
    net_horizon_rub: float
    roi_pct: float
    scenarios: list[ScenarioResult]
    fit: float
    impact: float
    ease: float
    priority: float
    quadrant: Quadrant
    wave: int | None
    model: ModelPick | None
    model_options: list[ModelOption] = Field(default_factory=list)
    flags: list[Flag]


class InfraLine(BaseModel):
    model_id: str
    name: str
    process_ids: list[str]
    units: int
    fixed_rub_month: float


class PortfolioSummary(BaseModel):
    processes_total: int
    processes_blocked: int
    recommended_count: int
    total_hours_month: float
    manual_cost_month_rub: float
    hours_saved_month: float
    fte_equivalent: float
    benefit_month_rub: float
    cost_month_rub: float
    net_month_rub: float
    implementation_rub: float
    payback_months: float | None
    net_horizon_rub: float
    roi_pct: float
    quadrant_counts: dict[str, int]
    infrastructure: list[InfraLine]


class RoadmapWave(BaseModel):
    wave: int
    title: str
    process_ids: list[str]
    hours_saved_month: float
    implementation_rub: float
    net_horizon_rub: float


class PortfolioScenario(BaseModel):
    key: str
    label: str
    implementation_rub: float
    net_month_rub: float
    net_horizon_rub: float
    payback_months: float | None


class AssessmentResult(BaseModel):
    assumptions: Assumptions
    processes: list[ProcessResult]
    summary: PortfolioSummary
    portfolio_scenarios: list[PortfolioScenario] = Field(default_factory=list)
    roadmap: list[RoadmapWave]
    warnings: list[str]
    catalog_as_of: date
    data_status: str


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class AssessmentEngine:
    def __init__(self, scoring: ScoringConfig, advisor: Advisor) -> None:
        self.scoring = scoring
        self.advisor = advisor

    def resolve_assumptions(self, overrides: dict[str, Any] | None = None) -> Assumptions:
        merged = self.scoring.assumptions.model_dump()
        if overrides:
            merged.update({k: v for k, v in overrides.items() if v is not None})
        return Assumptions.model_validate(merged)

    # --- подбор модели -------------------------------------------------------------------

    def _tokens(self, p: Process, a: Assumptions) -> tuple[int, int]:
        profile = self.scoring.task_types[p.task_type]
        tokens_in = p.tokens_in or profile.tokens_in
        tokens_out = p.tokens_out if p.tokens_out is not None else profile.tokens_out
        return math.ceil(tokens_in * a.llm_overhead), math.ceil(tokens_out * a.llm_overhead)

    def _workload(self, p: Process, a: Assumptions) -> Workload:
        profile = self.scoring.task_types[p.task_type]
        tokens_in, tokens_out = self._tokens(p, a)
        return Workload(
            task_type=p.task_type,
            data_sensitivity=p.data_sensitivity,
            requests_per_month=p.runs_per_month,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            min_quality=min(5, profile.min_quality + (1 if p.risk_level >= 4 else 0)),
            must_self_host=p.must_self_host,
            allow_workarounds=a.allow_workarounds,
            prefer=Preference(a.model_preference),
            supported_region=a.supported_region,
            deepseek_period=a.deepseek_period,
        )

    def _allocate_infrastructure(
        self,
        processes: Sequence[Process],
        picks: dict[str, Recommendation | None],
        a: Assumptions,
        advisor: Advisor,
        active: set[str],
    ) -> tuple[dict[str, Recommendation | None], list[InfraLine]]:
        """Разделить фиксированные расходы self-hosted модели между активными процессами.

        Доли пропорциональны токенам. Процесс, выпавший из «активных», показывается так,
        будто он подключается к уже работающему серверу.
        """
        allocated = dict(picks)
        groups: dict[str, list[Process]] = defaultdict(list)
        for p in processes:
            pick = picks[p.id]
            if pick and pick.deployment is Deployment.SELF_HOSTED and pick.cost.fixed_rub > 0:
                groups[pick.model_id].append(p)

        lines: list[InfraLine] = []
        for model_id, members in groups.items():
            model = advisor.catalog.get(model_id)
            capacity = model.pricing.capacity_mtok_month or math.inf
            monthly_fixed = advisor.to_rub(model.pricing.fixed_monthly, model.pricing.currency)
            volume = {p.id: p.runs_per_month * sum(self._tokens(p, a)) / 1_000_000 for p in members}

            def fixed_for(
                total: float, per_unit: float = monthly_fixed, cap: float = capacity
            ) -> tuple[float, int]:
                units = max(1, math.ceil(total / cap))
                return per_unit * units, units

            active_members = [p for p in members if p.id in active]
            active_volume = sum(volume[p.id] for p in active_members)
            for p in members:
                pick = picks[p.id]
                if pick is None:  # pragma: no cover - группа строится из непустых выборов
                    continue
                if a.share_infrastructure:
                    pool = active_volume + (0.0 if p.id in active else volume[p.id])
                    fixed_total, units = fixed_for(pool)
                    share = fixed_total * volume[p.id] / pool
                else:
                    share, units = fixed_for(volume[p.id])
                cost = CostBreakdown(
                    variable_rub=pick.cost.variable_rub,
                    fixed_rub=round(share, 2),
                    total_rub=round(pick.cost.variable_rub + share, 2),
                    units=units,
                )
                allocated[p.id] = pick.model_copy(update={"cost": cost})
            if active_members:
                if a.share_infrastructure:
                    line_fixed, line_units = fixed_for(active_volume)
                else:
                    parts = [fixed_for(volume[p.id]) for p in active_members]
                    line_fixed = sum(f for f, _ in parts)
                    line_units = sum(u for _, u in parts)
                lines.append(
                    InfraLine(
                        model_id=model_id,
                        name=model.name,
                        process_ids=[p.id for p in active_members],
                        units=line_units,
                        fixed_rub_month=round(line_fixed, 2),
                    )
                )
        return allocated, lines

    # --- экономика процесса -------------------------------------------------------------

    @staticmethod
    def _scenario(
        key: str,
        factors: ScenarioFactors,
        benefit: float,
        llm: float,
        implementation: float,
        a: Assumptions,
    ) -> ScenarioResult:
        benefit_s = benefit * factors.savings
        llm_s = llm * factors.llm_cost
        impl_s = implementation * factors.implementation
        support_s = a.support_share_per_month * impl_s
        net_month = benefit_s - llm_s - support_s
        total_cost = impl_s + (llm_s + support_s) * a.horizon_months
        net_horizon = benefit_s * a.horizon_months - total_cost
        return ScenarioResult(
            key=key,
            label=factors.label,
            net_rub_month=round(net_month, 2),
            payback_months=round(max(impl_s / net_month, 0.01), 2) if net_month > 0 else None,
            net_horizon_rub=round(net_horizon, 2),
            roi_pct=round(net_horizon / total_cost * 100, 1) if total_cost > 0 else 0.0,
        )

    def _evaluate(self, p: Process, pick: Recommendation | None, a: Assumptions) -> ProcessResult:
        cfg = self.scoring
        profile = cfg.task_types[p.task_type]
        hourly = p.hourly_cost_rub or a.default_hourly_cost_rub

        hours = p.runs_per_month * p.minutes_per_run / 60
        standardization_factor = 0.55 + 0.45 * (p.standardization - 1) / 4
        digital_factor = 0.50 + 0.50 * (p.digital_readiness - 1) / 4
        automation_share = profile.base_automation * standardization_factor * digital_factor
        review_share = min(0.6, profile.review_overhead + 0.05 * (p.risk_level - 1))
        net_share = automation_share * (1 - review_share)
        hours_saved = hours * net_share
        savings = hours_saved * hourly
        error_savings = p.runs_per_month * p.error_rate * p.error_cost_rub * a.error_reduction

        days = min(
            MAX_IMPLEMENTATION_DAYS,
            profile.implementation_days
            * cfg.complexity.digital_readiness[p.digital_readiness]
            * cfg.complexity.risk[p.risk_level]
            * cfg.complexity.sensitivity[p.data_sensitivity],
        )
        implementation = days * a.implementation_day_rub
        llm_cost = pick.cost.total_rub if pick else 0.0
        support = a.support_share_per_month * implementation
        benefit = savings + error_savings

        feasible = pick is not None
        scenarios: list[ScenarioResult] = []
        base = self._scenario("base", cfg.scenarios["base"], benefit, llm_cost, implementation, a)
        if feasible:
            scenarios = [
                self._scenario(key, f, benefit, llm_cost, implementation, a)
                for key, f in cfg.scenarios.items()
            ]
        net_horizon = base.net_horizon_rub if feasible else 0.0

        fit = 100 * (
            0.40 * min(1.0, profile.base_automation / 0.70)
            + 0.25 * (p.standardization - 1) / 4
            + 0.20 * (p.digital_readiness - 1) / 4
            + 0.15 * (5 - p.risk_level) / 4
        )
        impact = 100 * (1 - math.exp(-max(net_horizon, 0.0) / a.impact_scale_rub))
        ease = 100 * (
            0.50 * (1 - min(days, 40.0) / 40.0)
            + 0.25 * (p.digital_readiness - 1) / 4
            + 0.25 * (5 - p.risk_level) / 4
        )
        weights = cfg.priority_weights
        priority = weights.impact * impact + weights.ease * ease + weights.fit * fit
        if not feasible:
            quadrant, priority = Quadrant.BLOCKED, 0.0
        elif net_horizon <= 0:
            quadrant = Quadrant.POSTPONE
        else:
            high_impact = impact >= cfg.thresholds.impact
            easy = ease >= cfg.thresholds.ease
            quadrant = (
                Quadrant.QUICK_WIN
                if high_impact and easy
                else Quadrant.STRATEGIC
                if high_impact
                else Quadrant.FILL_IN
                if easy
                else Quadrant.POSTPONE
            )

        model_pick = None
        if pick:
            model_pick = ModelPick(
                model_id=pick.model_id,
                name=pick.name,
                deployment=pick.deployment,
                requires_masking=pick.requires_masking,
                quality=pick.quality,
                score=pick.score,
                cost=pick.cost,
            )

        return ProcessResult(
            rank=0,
            id=p.id,
            name=p.name,
            department=p.department,
            task_type=p.task_type,
            data_sensitivity=p.data_sensitivity,
            feasible=feasible,
            hours_per_month=round(hours, 1),
            manual_cost_month_rub=round(hours * hourly, 2),
            automation_share=round(automation_share, 4),
            net_share=round(net_share, 4),
            hours_saved_month=round(hours_saved, 1),
            savings_month_rub=round(savings, 2),
            error_savings_month_rub=round(error_savings, 2),
            llm_cost_month_rub=round(llm_cost, 2),
            support_month_rub=round(support, 2),
            implementation_days=round(days, 1),
            implementation_rub=round(implementation, 2),
            net_month_rub=base.net_rub_month if feasible else 0.0,
            payback_months=base.payback_months if feasible else None,
            net_horizon_rub=round(net_horizon, 2),
            roi_pct=base.roi_pct if feasible else 0.0,
            scenarios=scenarios,
            fit=round(fit, 1),
            impact=round(impact, 1),
            ease=round(ease, 1),
            priority=round(priority, 1),
            quadrant=quadrant,
            wave=QUADRANT_WAVE.get(quadrant),
            model=model_pick,
            flags=self._flags(p, pick, profile.min_quality, hours, net_horizon, a),
        )

    def _flags(
        self,
        p: Process,
        pick: Recommendation | None,
        base_min_quality: int,
        hours: float,
        net_horizon: float,
        a: Assumptions,
    ) -> list[Flag]:
        flags: list[Flag] = []

        def add(code: str, severity: Severity, message: str) -> None:
            flags.append(Flag(code=code, severity=severity, message=message))

        if p.data_sensitivity is Sensitivity.PERSONAL:
            add(
                "personal_data",
                Severity.INFO,
                "Персональные данные: допустимы модели с размещением в РФ или self-hosted, "
                "перед отправкой — обезличивание.",
            )
        elif p.data_sensitivity is Sensitivity.CONFIDENTIAL:
            add(
                "confidential_data",
                Severity.INFO,
                "Коммерческая тайна: зарубежные облака исключены политикой данных.",
            )
        if p.task_type is TaskType.DECISION_SUPPORT and p.data_sensitivity is Sensitivity.PERSONAL:
            add(
                "automated_decision",
                Severity.CRITICAL,
                "Решения о людях нельзя принимать только по ответу модели (ограничения 152-ФЗ): "
                "модель может лишь готовить рекомендацию для человека.",
            )
        if p.risk_level >= 4 or p.task_type is TaskType.DECISION_SUPPORT:
            add(
                "human_in_the_loop",
                Severity.WARNING,
                "Высокий риск ошибки: результат модели должен проверять человек (human-in-the-loop).",
            )
        if p.digital_readiness <= 2:
            add(
                "low_digital_readiness",
                Severity.WARNING,
                "Входные данные плохо оцифрованы: потребуются OCR и интеграции — это учтено "
                "в сроках и стоимости, но повышает риск проекта.",
            )
        if pick is None:
            needed = min(5, base_min_quality + (1 if p.risk_level >= 4 else 0))
            add(
                "no_compliant_model",
                Severity.CRITICAL,
                f"Нет модели, которая одновременно проходит политику данных и даёт качество "
                f"не ниже {needed}/5. Рассмотрите self-hosted решение флагманского класса "
                "или оставьте задачу человеку.",
            )
        else:
            if pick.requires_masking:
                add(
                    "needs_masking",
                    Severity.INFO,
                    f"Перед отправкой в «{pick.name}» данные нужно обезличивать.",
                )
            if pick.deployment is Deployment.SELF_HOSTED:
                add(
                    "self_hosted",
                    Severity.INFO,
                    "Модель разворачивается в вашем контуре: заложены расходы на GPU-инфраструктуру.",
                )
            if net_horizon <= 0:
                add(
                    "negative_roi",
                    Severity.WARNING,
                    f"Не окупается за {a.horizon_months} мес. при текущих допущениях "
                    f"(чистый эффект {format_rub(net_horizon)}).",
                )
        if hours < 10:
            add("low_volume", Severity.INFO, "Малый объём процесса: абсолютный эффект ограничен.")
        if hours > 800:
            add(
                "large_volume",
                Severity.INFO,
                f"Процесс занимает около {hours / HOURS_PER_FTE:.0f} ставок: проверьте исходные данные.",
            )
        return flags

    # --- портфель -------------------------------------------------------------------------

    def assess(
        self, processes: Sequence[Process], overrides: dict[str, Any] | None = None
    ) -> AssessmentResult:
        if not processes:
            raise ValueError("Список процессов пуст")
        ids = [p.id for p in processes]
        duplicates = sorted({i for i in ids if ids.count(i) > 1})
        if duplicates:
            raise ValueError(f"Повторяющиеся id процессов: {', '.join(duplicates)}")

        a = self.resolve_assumptions(overrides)
        advisor = Advisor(
            self.advisor.catalog,
            self.advisor.policy,
            usd_rub=a.usd_rub,
            today=self.advisor.today,
            data_dir=self.advisor.data_dir,
        )
        picks: dict[str, Recommendation | None] = {}
        for p in processes:
            advice = advisor.recommend(self._workload(p, a), top=1)
            picks[p.id] = advice.recommendations[0] if advice.recommendations else None
        shared_ids = {
            pid
            for pid, pick in picks.items()
            if pick and pick.deployment is Deployment.SELF_HOSTED and pick.cost.fixed_rub > 0
        }
        # Убыточные процессы больше не делят сервер с остальными — пересчитываем, пока состав не стабилен.
        active = {p.id for p in processes}
        while True:
            allocated, infrastructure = self._allocate_infrastructure(
                processes, picks, a, advisor, active
            )
            results = [self._evaluate(p, allocated[p.id], a) for p in processes]
            dropped = {
                r.id
                for r in results
                if r.id in active and r.id in shared_ids and r.feasible and r.net_horizon_rub <= 0
            }
            if not dropped:
                break
            active -= dropped
        results.sort(key=lambda r: (-r.priority, r.id))
        results = [
            r.model_copy(
                update={
                    "rank": i,
                    "model_options": advisor.model_options(
                        self._workload(next(p for p in processes if p.id == r.id), a)
                    ),
                }
            )
            for i, r in enumerate(results, start=1)
        ]

        summary = self._summarize(results, infrastructure, a)
        return AssessmentResult(
            assumptions=a,
            processes=results,
            summary=summary,
            portfolio_scenarios=self._portfolio_scenarios(results, summary, a),
            roadmap=self._roadmap(results),
            warnings=self._warnings(advisor)
            + (
                [
                    "Предполагается доступ к зарубежным API (аккаунт и оплата в поддерживаемой стране). Из РФ напрямую он невозможен; допущение можно снять в настройках расчёта."
                ]
                if a.supported_region
                else []
            ),
            catalog_as_of=advisor.catalog.as_of,
            data_status=advisor.catalog.data_status,
        )

    def _portfolio_scenarios(
        self, results: list[ProcessResult], summary: PortfolioSummary, a: Assumptions
    ) -> list[PortfolioScenario]:
        llm = sum(r.llm_cost_month_rub for r in results if r.quadrant in QUADRANT_WAVE)
        rows = []
        for key, factors in self.scoring.scenarios.items():
            scenario = self._scenario(
                key, factors, summary.benefit_month_rub, llm, summary.implementation_rub, a
            )
            rows.append(
                PortfolioScenario(
                    key=key,
                    label=factors.label,
                    implementation_rub=round(
                        summary.implementation_rub * factors.implementation, 2
                    ),
                    net_month_rub=summary.net_month_rub
                    if key == "base"
                    else scenario.net_rub_month,
                    net_horizon_rub=summary.net_horizon_rub
                    if key == "base"
                    else scenario.net_horizon_rub,
                    payback_months=summary.payback_months
                    if key == "base"
                    else scenario.payback_months,
                )
            )
        return rows

    def _summarize(
        self, results: list[ProcessResult], infrastructure: list[InfraLine], a: Assumptions
    ) -> PortfolioSummary:
        recommended = [r for r in results if r.quadrant in QUADRANT_WAVE]
        benefit = sum(r.savings_month_rub + r.error_savings_month_rub for r in recommended)
        cost = sum(r.llm_cost_month_rub + r.support_month_rub for r in recommended)
        implementation = sum(r.implementation_rub for r in recommended)
        net_month = benefit - cost
        net_horizon = benefit * a.horizon_months - cost * a.horizon_months - implementation
        total_cost = implementation + cost * a.horizon_months
        counts = {q.value: 0 for q in Quadrant}
        for r in results:
            counts[r.quadrant.value] += 1
        hours_saved = sum(r.hours_saved_month for r in recommended)
        return PortfolioSummary(
            processes_total=len(results),
            processes_blocked=counts[Quadrant.BLOCKED.value],
            recommended_count=len(recommended),
            total_hours_month=round(sum(r.hours_per_month for r in results), 1),
            manual_cost_month_rub=round(sum(r.manual_cost_month_rub for r in results), 2),
            hours_saved_month=round(hours_saved, 1),
            fte_equivalent=round(hours_saved / HOURS_PER_FTE, 2),
            benefit_month_rub=round(benefit, 2),
            cost_month_rub=round(cost, 2),
            net_month_rub=round(net_month, 2),
            implementation_rub=round(implementation, 2),
            payback_months=(
                round(max(implementation / net_month, 0.01), 2) if net_month > 0 else None
            ),
            net_horizon_rub=round(net_horizon, 2),
            roi_pct=round(net_horizon / total_cost * 100, 1) if total_cost > 0 else 0.0,
            quadrant_counts=counts,
            infrastructure=infrastructure,
        )

    @staticmethod
    def _roadmap(results: list[ProcessResult]) -> list[RoadmapWave]:
        waves: list[RoadmapWave] = []
        for wave, title in WAVE_TITLES.items():
            members = [r for r in results if r.wave == wave]
            if not members:
                continue
            waves.append(
                RoadmapWave(
                    wave=wave,
                    title=title,
                    process_ids=[r.id for r in members],
                    hours_saved_month=round(sum(r.hours_saved_month for r in members), 1),
                    implementation_rub=round(sum(r.implementation_rub for r in members), 2),
                    net_horizon_rub=round(sum(r.net_horizon_rub for r in members), 2),
                )
            )
        return waves

    @staticmethod
    def _warnings(advisor: Advisor) -> list[str]:
        warnings: list[str] = []
        if advisor.catalog.data_status == "illustrative":
            warnings.append(
                "Качество и ROI основаны на экспертных допущениях; тарифы моделей сверены с официальными "
                "страницами провайдеров. Перед решением проверьте актуальные цены и качество на своих задачах."
            )
        stale = advisor.catalog.stale_entries(advisor.today)
        if stale:
            warnings.append(f"Записей каталога, не проверявшихся более 90 дней: {len(stale)}.")
        if advisor.price_warnings:
            warnings.append(
                f"Тарифы давно не сверялись: {len(advisor.price_warnings)} шт. — расчёт показан, "
                "но перед решением проверьте цены у провайдеров."
            )
        return warnings


__all__ = [
    "AssessmentEngine",
    "AssessmentResult",
    "Flag",
    "InfraLine",
    "ModelPick",
    "PortfolioSummary",
    "Process",
    "ProcessResult",
    "RoadmapWave",
    "ScenarioResult",
]
