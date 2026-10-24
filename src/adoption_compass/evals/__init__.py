"""Харнесс оценки качества моделей на собственных данных."""

from .metrics import ClassStats, Metrics, compute_metrics, percentile
from .providers import (
    SIM_PROFILES,
    Completion,
    KeywordBaselineProvider,
    OpenAICompatibleProvider,
    Pricing,
    Provider,
    ProviderError,
    SimulatedProvider,
    estimate_tokens,
)
from .runner import (
    EvalReport,
    Failure,
    LatencyStats,
    reports_markdown,
    run_demo,
    run_eval,
    with_baseline_lift,
)
from .task import EvalItem, EvalTask, LabelSpec, load_items, load_task, parse_items

__all__ = [
    "SIM_PROFILES",
    "ClassStats",
    "Completion",
    "EvalItem",
    "EvalReport",
    "EvalTask",
    "Failure",
    "KeywordBaselineProvider",
    "LabelSpec",
    "LatencyStats",
    "Metrics",
    "OpenAICompatibleProvider",
    "Pricing",
    "Provider",
    "ProviderError",
    "SimulatedProvider",
    "compute_metrics",
    "estimate_tokens",
    "load_items",
    "load_task",
    "parse_items",
    "percentile",
    "reports_markdown",
    "run_demo",
    "run_eval",
    "with_baseline_lift",
]
