"""Сборка сервисов приложения: единая точка для API, CLI и MCP-сервера."""

from dataclasses import dataclass

from .advisor import Advisor
from .assessment import AssessmentEngine
from .catalog import Catalog, load_catalog
from .config import Settings
from .csv_io import parse_processes_csv
from .demo import DemoStorage
from .evals import EvalItem, EvalTask, load_items, load_task
from .prompts import PromptLibrary, PromptLinter
from .resources import read_data_text
from .safety import Policy, SafetyGuard
from .scoring import ScoringConfig, load_scoring
from .storage import Storage, StoredAssessment


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
    if settings.demo_mode:
        catalog = catalog.model_copy(
            update={"models": [catalog.get(i) for i in catalog.primary_model_ids]}
        )
        scoring = scoring.model_copy(
            update={
                "assumptions": scoring.assumptions.model_copy(
                    update={"supported_region": True, "model_preference": "quality"}
                )
            }
        )
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
        data_dir=data_dir,
    )
    task = load_task(data_dir)
    services = Services(
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
        storage=Storage(settings.db_path) if with_storage and not settings.demo_mode else None,
    )
    if with_storage and settings.demo_mode:
        processes = parse_processes_csv(
            read_data_text("samples/demo-processes.csv", data_dir)
        ).processes
        result = services.engine.assess(processes)
        services.storage = DemoStorage(
            StoredAssessment(
                id="demo",
                name="Демо: ООО «Ромашка-Сервис»",
                created_at="2026-10-24T00:00:00+00:00",
                processes_count=len(processes),
                recommended_count=result.summary.recommended_count,
                hours_saved_month=result.summary.hours_saved_month,
                net_horizon_rub=result.summary.net_horizon_rub,
                request={"processes": [p.model_dump(mode="json") for p in processes]},
                result=result.model_dump(mode="json"),
            )
        )
    return services
