"""Прогон оценки, сравнение провайдеров и отчёт."""

from collections.abc import Sequence
from statistics import mean

from pydantic import BaseModel

from .metrics import Metrics, compute_metrics, percentile
from .providers import (
    SIM_PROFILES,
    KeywordBaselineProvider,
    Provider,
    ProviderError,
    SimulatedProvider,
)
from .task import EvalItem, EvalTask


class LatencyStats(BaseModel):
    mean_ms: float
    p50_ms: float
    p95_ms: float


class Failure(BaseModel):
    id: str
    expected: str
    got: str | None
    text: str


class EvalReport(BaseModel):
    provider: str
    task_id: str
    is_baseline: bool
    n: int
    metrics: Metrics
    latency: LatencyStats
    tokens_in: int
    tokens_out: int
    cost_rub: float | None
    cost_per_1k_rub: float | None
    cost_per_correct_rub: float | None
    errors: int
    failures: list[Failure]
    accuracy_lift: float | None = None


def run_eval(
    provider: Provider, task: EvalTask, items: Sequence[EvalItem], *, max_failures: int = 8
) -> EvalReport:
    system = task.system_prompt()
    predictions: list[str | None] = []
    latencies: list[float] = []
    tokens_in = tokens_out = errors = 0
    failures: list[Failure] = []
    for item in items:
        guess: str | None
        try:
            completion = provider.complete(system, task.user_prompt(item.text))
        except ProviderError:
            errors += 1
            guess = None
        else:
            guess = task.extract_label(completion.text)
            latencies.append(completion.latency_ms)
            tokens_in += completion.tokens_in
            tokens_out += completion.tokens_out
        predictions.append(guess)
        if guess != item.label and len(failures) < max_failures:
            failures.append(
                Failure(id=item.id, expected=item.label, got=guess, text=item.text[:140])
            )

    metrics = compute_metrics(task.label_names, [i.label for i in items], predictions)
    cost: float | None = None
    if provider.pricing is not None:
        cost = (
            tokens_in * provider.pricing.input_per_mtok_rub
            + tokens_out * provider.pricing.output_per_mtok_rub
        ) / 1_000_000
    correct = round(metrics.accuracy * metrics.n)
    return EvalReport(
        provider=provider.name,
        task_id=task.id,
        is_baseline=provider.is_baseline,
        n=len(items),
        metrics=metrics,
        latency=LatencyStats(
            mean_ms=round(mean(latencies), 1) if latencies else 0.0,
            p50_ms=percentile(latencies, 50),
            p95_ms=percentile(latencies, 95),
        ),
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        cost_rub=round(cost, 4) if cost is not None else None,
        cost_per_1k_rub=round(cost / len(items) * 1000, 4) if cost is not None else None,
        cost_per_correct_rub=round(cost / correct, 5) if cost is not None and correct else None,
        errors=errors,
        failures=failures,
    )


def with_baseline_lift(reports: list[EvalReport]) -> list[EvalReport]:
    """Добавить прирост точности относительно baseline (если он есть среди отчётов)."""
    baseline = next((r for r in reports if r.is_baseline), None)
    if baseline is None:
        return reports
    return [
        r.model_copy(
            update={"accuracy_lift": round(r.metrics.accuracy - baseline.metrics.accuracy, 4)}
        )
        for r in reports
    ]


def run_demo(task: EvalTask, items: Sequence[EvalItem]) -> list[EvalReport]:
    """Baseline на правилах + три симулируемых профиля — всё офлайн."""
    providers: list[Provider] = [KeywordBaselineProvider(task)]
    providers += [SimulatedProvider(name, task, list(items)) for name in SIM_PROFILES]
    return with_baseline_lift([run_eval(p, task, items) for p in providers])


def reports_markdown(reports: Sequence[EvalReport], task: EvalTask) -> str:
    lines = [
        f"# Оценка качества: {task.title}",
        "",
        f"Размер набора: {reports[0].n if reports else 0}. Метрики: точность и macro-F1; "
        "стоимость — по ценам из настроек провайдера.",
        "",
        "| Модель | Точность | macro-F1 | Невалидных | p50, мс | p95, мс | Стоимость, ₽ | ₽ за верный ответ | Прирост к baseline |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in sorted(reports, key=lambda x: (-x.metrics.accuracy, x.cost_rub or 0.0)):
        lift = "—" if r.accuracy_lift is None else f"{r.accuracy_lift * 100:+.1f} п.п."
        cost = "—" if r.cost_rub is None else f"{r.cost_rub:.2f}"
        per_correct = "—" if r.cost_per_correct_rub is None else f"{r.cost_per_correct_rub:.4f}"
        lines.append(
            f"| {r.provider} | {r.metrics.accuracy:.1%} | {r.metrics.macro_f1:.3f} | "
            f"{r.metrics.invalid} | {r.latency.p50_ms:.0f} | {r.latency.p95_ms:.0f} | "
            f"{cost} | {per_correct} | {lift} |"
        )
    if any(r.provider.startswith("sim:") for r in reports):
        lines += [
            "",
            "> Профили `sim:*` — детерминированный симулятор: цифры иллюстрируют работу харнесса "
            "и не отражают качество реальных моделей.",
            "",
        ]
    return "\n".join(lines)
