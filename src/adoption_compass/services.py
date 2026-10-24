"""Сборка сервисов приложения: единая точка для API, CLI и MCP-сервера."""

from dataclasses import dataclass

from .advisor import Advisor
from .assessment import AssessmentEngine
from .catalog import Catalog, load_catalog
from .config import Settings
from .evals import EvalItem, EvalTask, load_items, load_task
from .prompts import PromptLibrary, PromptLinter
from .safety import Policy, SafetyGuard
from .scoring import ScoringConfig, load_scoring
from .storage import Storage


@dataclass
class Services:
    settings: Settings
    catalog: Catalog
    policy: Policy
    guard: SafetyGuard
    linter: PromptLinter
    library: PromptLibrary
    scoring: ScoringConfig
    advisor: Advisor
    engine: AssessmentEngine
    eval_task: EvalTask
    eval_items: list[EvalItem]
    storage: Storage | None = None


def build_services(settings: Settings | None = None, *, with_storage: bool = True) -> Services:
    settings = settings or Settings.from_env()
    data_dir = settings.data_dir
    catalog = load_catalog(data_dir)
    policy = Policy.load(data_dir)
    scoring = load_scoring(data_dir)
    if settings.usd_rub:
        scoring = scoring.model_copy(
            update={
                "assumptions": scoring.assumptions.model_copy(update={"usd_rub": settings.usd_rub})
            }
        )
    guard = SafetyGuard(policy)
    linter = PromptLinter(guard)
    library = PromptLibrary.load(guard, linter, data_dir)
    advisor = Advisor(
        catalog,
        policy,
        usd_rub=settings.usd_rub or scoring.assumptions.usd_rub,
        today=settings.current_date,
    )
    task = load_task(data_dir)
    return Services(
        settings=settings,
        catalog=catalog,
        policy=policy,
        guard=guard,
        linter=linter,
        library=library,
        scoring=scoring,
        advisor=advisor,
        engine=AssessmentEngine(scoring, advisor),
        eval_task=task,
        eval_items=load_items(task, data_dir),
        storage=Storage(settings.db_path) if with_storage else None,
    )
