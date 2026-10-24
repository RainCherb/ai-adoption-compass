"""REST API: FastAPI-приложение с раздачей собранного фронтенда."""

import json
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated, Any

from fastapi import (
    APIRouter,
    Depends,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .. import __version__
from ..advisor import AdviceResult, Preference, Workload
from ..assessment import AssessmentResult, Process
from ..catalog_sources import source_status
from ..config import Settings
from ..csv_io import CsvFormatError, parse_processes_csv
from ..demo import DemoGuard
from ..domain import (
    ACTION_LABELS,
    DEPLOYMENT_LABELS,
    QUADRANT_LABELS,
    SENSITIVITY_LABELS,
    SENSITIVITY_ORDER,
    TASK_LABELS,
    Action,
    Deployment,
    Quadrant,
    TaskType,
)
from ..evals import reports_markdown, run_demo
from ..evals.benchmark import load_benchmark
from ..prompts import LintResult, PromptRenderError, PromptTemplate, RenderedPrompt, scaffold_prompt
from ..reports import assessment_csv, assessment_markdown
from ..resources import read_data_text
from ..services import Services, build_services
from .schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    AssessmentRequest,
    AssumptionsOverride,
    CatalogStatus,
    EvalDemoResponse,
    EvalLabelOut,
    EvalTaskOut,
    EventOut,
    EventsResponse,
    HealthResponse,
    LintRequest,
    MetaResponse,
    OptionOut,
    PolicyOut,
    RenderRequest,
    ScaffoldRequest,
    SensitivityOut,
    StoredAssessmentOut,
    TaskTypeOut,
    TextResponse,
    UnmaskRequest,
    UploadResponse,
)

PACKAGED_STATIC = Path(__file__).resolve().parent.parent / "static"
DOCS_PATHS = ("/api/docs", "/api/openapi.json")
CSP = (
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
    "form-action 'self'"
)
LANDING_HTML = """<!doctype html><html lang="ru"><meta charset="utf-8"><title>AI Adoption Compass</title>
<body style="font-family:system-ui;max-width:42rem;margin:4rem auto;padding:0 1rem">
<h1>AI Adoption Compass</h1>
<p>API работает. Веб-интерфейс не собран: выполните <code>make web</code> или откройте
<a href="/api/docs">документацию API</a>.</p></body></html>"""


def get_services(request: Request) -> Services:
    services: Services = request.app.state.services
    return services


ServicesDep = Annotated[Services, Depends(get_services)]
router = APIRouter(prefix="/api")


def _check_text(svc: Services, text: str) -> None:
    if len(text) > svc.settings.max_text_chars:
        raise HTTPException(413, f"Текст длиннее {svc.settings.max_text_chars} символов")


def _storage(svc: Services):  # type: ignore[no-untyped-def]
    if svc.storage is None:  # pragma: no cover - API всегда создаётся с хранилищем
        raise HTTPException(503, "Хранилище недоступно")
    return svc.storage


# --- служебные -----------------------------------------------------------------------------


@router.get("/health", response_model=HealthResponse, tags=["service"])
def health(svc: ServicesDep) -> HealthResponse:
    return HealthResponse(
        demo_mode=svc.settings.demo_mode,
        status="ok",
        version=__version__,
        database=_storage(svc).ping(),
        catalog=CatalogStatus(
            as_of=svc.catalog.as_of,
            data_status=svc.catalog.data_status,
            stale=len(svc.catalog.stale_entries(svc.settings.current_date)),
        ),
    )


@router.get("/meta", response_model=MetaResponse, tags=["service"])
def meta(svc: ServicesDep) -> MetaResponse:
    task_types = [
        TaskTypeOut(
            value=t.value,
            label=TASK_LABELS[t],
            tokens_in=svc.scoring.task_types[t].tokens_in,
            tokens_out=svc.scoring.task_types[t].tokens_out,
            min_quality=svc.scoring.task_types[t].min_quality,
            base_automation=svc.scoring.task_types[t].base_automation,
            implementation_days=svc.scoring.task_types[t].implementation_days,
        )
        for t in TaskType
    ]
    classes = svc.policy.document.classes
    return MetaResponse(
        demo_mode=svc.settings.demo_mode,
        version=__version__,
        task_types=task_types,
        sensitivities=[
            SensitivityOut(
                value=s.value,
                label=SENSITIVITY_LABELS[s],
                description=classes[s].description.strip(),
                examples=classes[s].examples,
            )
            for s in SENSITIVITY_ORDER
        ],
        deployments=[
            OptionOut(
                value=d.value,
                label=DEPLOYMENT_LABELS[d],
                description=svc.policy.document.deployments[d].description,
            )
            for d in Deployment
        ],
        preferences=[
            OptionOut(value=Preference.BALANCED.value, label="Баланс"),
            OptionOut(value=Preference.COST.value, label="Минимальная цена"),
            OptionOut(value=Preference.QUALITY.value, label="Максимальное качество"),
            OptionOut(value=Preference.SAFETY.value, label="Максимальная безопасность"),
        ],
        quadrants=[OptionOut(value=q.value, label=QUADRANT_LABELS[q]) for q in Quadrant],
        actions=[OptionOut(value=a.value, label=ACTION_LABELS[a]) for a in Action],
        default_assumptions=svc.scoring.assumptions.model_dump(),
        thresholds=svc.scoring.thresholds.model_dump(),
        limits={
            "max_text_chars": svc.settings.max_text_chars,
            "max_upload_bytes": svc.settings.max_upload_bytes,
        },
        catalog={
            "as_of": svc.catalog.as_of.isoformat(),
            "data_status": svc.catalog.data_status,
            "disclaimer": svc.catalog.disclaimer.strip(),
        },
    )


@router.get("/catalog", tags=["catalog"])
def catalog(svc: ServicesDep) -> dict[str, Any]:
    today = svc.settings.current_date
    return {
        "as_of": svc.catalog.as_of.isoformat(),
        "data_status": svc.catalog.data_status,
        "disclaimer": svc.catalog.disclaimer.strip(),
        "usd_rub": svc.advisor.usd_rub,
        "stale": [s.model_dump(mode="json") for s in svc.catalog.stale_entries(today)],
        "models": [m.model_dump(mode="json") for m in svc.catalog.models],
    }


# --- подбор моделей ------------------------------------------------------------------------


@router.get("/catalog/sources", tags=["catalog"])
def catalog_sources(svc: ServicesDep) -> dict[str, Any]:
    """Сохранённые снимки; сетевых запросов в обработчике нет."""
    return source_status(svc.settings.current_date, svc.settings.data_dir)


@router.post("/advice", response_model=AdviceResult, tags=["advisor"])
def advice(
    workload: Workload, svc: ServicesDep, top: Annotated[int, Query(ge=1, le=20)] = 5
) -> AdviceResult:
    return svc.advisor.recommend(workload, top=top)


# --- оценка процессов ----------------------------------------------------------------------


def _overrides(value: AssumptionsOverride | None) -> dict[str, Any] | None:
    return value.model_dump(exclude_none=True) if value else None


def _compute(
    svc: Services, processes: list[Process], overrides: dict[str, Any] | None
) -> AssessmentResult:
    if svc.settings.demo_mode and len(processes) > 50:
        raise HTTPException(422, "В публичном демо доступно не более 50 процессов за запрос")
    try:
        return svc.engine.assess(processes, overrides)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _persist(
    svc: Services, name: str, processes: list[Process], overrides: dict[str, Any] | None
) -> StoredAssessmentOut:
    if svc.settings.demo_mode:
        raise HTTPException(403, "В публичном демо сохранение отключено")
    result = _compute(svc, processes, overrides)
    storage = _storage(svc)
    request_payload = {
        "name": name,
        "processes": [p.model_dump(mode="json") for p in processes],
        "assumptions": overrides,
    }
    assessment_id = storage.save_assessment(name, request_payload, result.model_dump(mode="json"))
    storage.log_event(
        "assessment.created",
        {
            "assessment_id": assessment_id,
            "processes": len(processes),
            "recommended": result.summary.recommended_count,
        },
    )
    stored = storage.get_assessment(assessment_id)
    if stored is None:  # pragma: no cover
        raise HTTPException(500, "Не удалось сохранить оценку")
    return StoredAssessmentOut(
        id=stored.id,
        name=stored.name,
        created_at=stored.created_at,
        processes=processes,
        assumptions=overrides,
        result=result,
    )


@router.post("/assess", response_model=AssessmentResult, tags=["assessments"])
def assess(body: AssessmentRequest, svc: ServicesDep) -> AssessmentResult:
    """Расчёт без сохранения."""
    return _compute(svc, body.processes, _overrides(body.assumptions))


@router.post(
    "/assessments", response_model=StoredAssessmentOut, status_code=201, tags=["assessments"]
)
def create_assessment(body: AssessmentRequest, svc: ServicesDep) -> StoredAssessmentOut:
    return _persist(svc, body.name, body.processes, _overrides(body.assumptions))


@router.post(
    "/assessments/upload", response_model=UploadResponse, status_code=201, tags=["assessments"]
)
async def upload_assessment(
    svc: ServicesDep,
    file: Annotated[UploadFile, File(description="CSV со списком процессов")],
    name: Annotated[str | None, Form()] = None,
    assumptions: Annotated[
        str | None, Form(description="JSON с переопределением допущений")
    ] = None,
) -> UploadResponse:
    limit = svc.settings.max_upload_bytes
    raw = await file.read(limit + 1)
    if len(raw) > limit:
        raise HTTPException(413, f"Файл больше {limit // 1000} КБ")
    try:
        parsed = parse_processes_csv(raw)
    except CsvFormatError as exc:
        raise HTTPException(422, str(exc)) from exc
    if not parsed.processes:
        raise HTTPException(
            422,
            detail={
                "message": "В файле нет ни одной корректной строки",
                "errors": [e.model_dump() for e in parsed.errors[:20]],
            },
        )
    overrides: dict[str, Any] | None = None
    if assumptions:
        try:
            overrides = _overrides(AssumptionsOverride.model_validate(json.loads(assumptions)))
        except (json.JSONDecodeError, ValidationError) as exc:
            raise HTTPException(422, f"Некорректные допущения: {exc}") from exc
    title = (name or Path(file.filename or "").stem or "Загрузка CSV")[:120]
    stored = _persist(svc, title, parsed.processes, overrides)
    return UploadResponse(assessment=stored, parse_errors=parsed.errors)


@router.post(
    "/assessments/demo", response_model=UploadResponse, status_code=201, tags=["assessments"]
)
def demo_assessment(svc: ServicesDep) -> UploadResponse:
    """Оценка на демо-данных вымышленной компании."""
    if svc.settings.demo_mode:
        stored, _ = _stored_result(svc, "demo")
        return UploadResponse(assessment=stored, parse_errors=[])
    parsed = parse_processes_csv(read_data_text("samples/processes.csv"))
    stored = _persist(svc, "Демо: ООО «Ромашка-Сервис»", parsed.processes, None)
    return UploadResponse(assessment=stored, parse_errors=parsed.errors)


@router.get("/assessments", tags=["assessments"])
def list_assessments(
    svc: ServicesDep, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[dict[str, Any]]:
    return [s.model_dump() for s in _storage(svc).list_assessments(limit)]


def _stored_result(
    svc: Services, assessment_id: str
) -> tuple[StoredAssessmentOut, AssessmentResult]:
    stored = _storage(svc).get_assessment(assessment_id)
    if stored is None:
        raise HTTPException(404, "Оценка не найдена")
    result = AssessmentResult.model_validate(stored.result)
    return (
        StoredAssessmentOut(
            id=stored.id,
            name=stored.name,
            created_at=stored.created_at,
            processes=[Process.model_validate(p) for p in stored.request["processes"]],
            assumptions=stored.request.get("assumptions"),
            result=result,
        ),
        result,
    )


@router.get(
    "/assessments/{assessment_id}", response_model=StoredAssessmentOut, tags=["assessments"]
)
def get_assessment(assessment_id: str, svc: ServicesDep) -> StoredAssessmentOut:
    return _stored_result(svc, assessment_id)[0]


@router.delete("/assessments/{assessment_id}", status_code=204, tags=["assessments"])
def delete_assessment(assessment_id: str, svc: ServicesDep) -> Response:
    if not _storage(svc).delete_assessment(assessment_id):
        raise HTTPException(404, "Оценка не найдена")
    return Response(status_code=204)


@router.get("/assessments/{assessment_id}/report.md", tags=["assessments"])
def assessment_report(assessment_id: str, svc: ServicesDep) -> Response:
    stored, result = _stored_result(svc, assessment_id)
    text = assessment_markdown(
        result, title=f"Оценка процессов: {stored.name}", generated=svc.settings.current_date
    )
    return Response(
        text,
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="assessment-{assessment_id}.md"'},
    )


@router.get("/assessments/{assessment_id}/export.csv", tags=["assessments"])
def assessment_export(assessment_id: str, svc: ServicesDep) -> Response:
    _, result = _stored_result(svc, assessment_id)
    return Response(
        assessment_csv(result),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="assessment-{assessment_id}.csv"'},
    )


@router.get("/samples/processes.csv", tags=["assessments"])
def sample_processes() -> Response:
    return Response(
        read_data_text("samples/processes.csv"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="processes-template.csv"'},
    )


# --- безопасность данных -------------------------------------------------------------------


@router.post("/safety/analyze", response_model=AnalyzeResponse, tags=["safety"])
def safety_analyze(body: AnalyzeRequest, svc: ServicesDep) -> AnalyzeResponse:
    _check_text(svc, body.text)
    analysis = svc.guard.analyze(body.text, body.declared_sensitivity)
    report = analysis.report
    _storage(svc).log_event(
        "safety.analyze",
        {
            "chars": report.chars,
            "counts": report.counts,
            "declared": report.declared_sensitivity.value,
            "effective": report.effective_sensitivity.value,
            "has_secrets": report.has_secrets,
            "decisions": {d.target.value: d.action.value for d in report.decisions},
        },
    )
    return AnalyzeResponse(
        **report.model_dump(),
        mapping=analysis.masked.mapping if body.include_mapping else None,
    )


@router.post("/safety/unmask", response_model=TextResponse, tags=["safety"])
def safety_unmask(body: UnmaskRequest, svc: ServicesDep) -> TextResponse:
    _check_text(svc, body.text)
    return TextResponse(text=svc.guard.unmask(body.text, body.mapping))


@router.get("/safety/policy", response_model=PolicyOut, tags=["safety"])
def safety_policy(svc: ServicesDep) -> PolicyOut:
    doc = svc.policy.document
    return PolicyOut(
        updated=doc.updated,
        disclaimer=doc.disclaimer.strip(),
        classes=[
            SensitivityOut(
                value=s.value,
                label=doc.classes[s].label,
                description=doc.classes[s].description.strip(),
                examples=doc.classes[s].examples,
            )
            for s in SENSITIVITY_ORDER
        ],
        deployments=[
            OptionOut(
                value=d.value,
                label=doc.deployments[d].label,
                description=doc.deployments[d].description,
            )
            for d in Deployment
        ],
        actions=[
            OptionOut(value=a.value, label=ACTION_LABELS[a], description=doc.actions[a])
            for a in Action
        ],
        matrix=doc.matrix,
        do=doc.do,
        dont=doc.dont,
        secrets_message=doc.secrets.message.strip(),
        handout_markdown=svc.policy.handout_markdown(),
    )


# --- шаблоны и линтер запросов -------------------------------------------------------------


@router.get("/prompts", tags=["prompts"])
def list_prompts(
    svc: ServicesDep, department: str | None = None, task_type: TaskType | None = None
) -> dict[str, Any]:
    templates = svc.library.list_templates(department=department, task_type=task_type)
    return {
        "departments": svc.library.departments(),
        "templates": [t.model_dump(mode="json") for t in templates],
    }


@router.get("/prompts/{template_id}", response_model=PromptTemplate, tags=["prompts"])
def get_prompt(template_id: str, svc: ServicesDep) -> PromptTemplate:
    try:
        return svc.library.get(template_id)
    except KeyError:
        raise HTTPException(404, "Шаблон не найден") from None


@router.post("/prompts/lint", response_model=LintResult, tags=["prompts"])
def lint_prompt(body: LintRequest, svc: ServicesDep) -> LintResult:
    _check_text(svc, body.text)
    result = svc.linter.lint(body.text)
    _storage(svc).log_event(
        "prompt.lint",
        {"chars": len(body.text), "score": result.score, "sensitive": result.sensitive},
    )
    return result


@router.post("/prompts/scaffold", response_model=TextResponse, tags=["prompts"])
def scaffold(body: ScaffoldRequest) -> TextResponse:
    return TextResponse(text=scaffold_prompt(body.task, body.role))


@router.post("/prompts/{template_id}/render", response_model=RenderedPrompt, tags=["prompts"])
def render_prompt(template_id: str, body: RenderRequest, svc: ServicesDep) -> RenderedPrompt:
    for value in body.values.values():
        _check_text(svc, value)
    try:
        rendered = svc.library.render(template_id, body.values)
    except KeyError:
        raise HTTPException(404, "Шаблон не найден") from None
    except PromptRenderError as exc:
        raise HTTPException(
            422, detail={"message": "Проверьте поля", "errors": exc.errors}
        ) from exc
    _storage(svc).log_event(
        "prompt.render", {"template": template_id, "sensitive": rendered.sensitive}
    )
    return rendered


# --- оценка качества моделей ---------------------------------------------------------------


@router.get("/evals/demo", response_model=EvalDemoResponse, tags=["evals"])
def evals_demo(svc: ServicesDep) -> EvalDemoResponse:
    """Офлайн-сравнение baseline и симулируемых моделей на встроенном наборе обращений."""
    task = svc.eval_task
    reports = run_demo(task, svc.eval_items)
    return EvalDemoResponse(
        task=EvalTaskOut(
            id=task.id,
            title=task.title,
            description=task.description.strip(),
            labels=[EvalLabelOut(name=n, title=s.title) for n, s in task.labels.items()],
            items=len(svc.eval_items),
        ),
        reports=reports,
        markdown=reports_markdown(reports, task),
    )


# --- журнал --------------------------------------------------------------------------------


@router.get("/evals/measured", response_model=EvalDemoResponse, tags=["evals"])
def evals_measured(svc: ServicesDep) -> EvalDemoResponse:
    """Сохранённые реальные измерения. Запрос не запускает LLM и ничего не оплачивает."""
    try:
        artifact = load_benchmark(svc.settings.data_dir)
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(
            503, "Реальные измерения отсутствуют или устарели; требуется новый прогон"
        ) from exc
    task = svc.eval_task
    return EvalDemoResponse(
        kind="measured",
        reports=artifact.reports,
        markdown=artifact.markdown,
        task=EvalTaskOut(
            id=task.id,
            title=task.title,
            description=task.description.strip(),
            labels=[EvalLabelOut(name=n, title=s.title) for n, s in task.labels.items()],
            items=len(svc.eval_items),
        ),
        provenance={
            "created_at": artifact.created_at.isoformat(),
            "dataset_sha256": artifact.dataset_sha256,
            "prompt_sha256": artifact.prompt_sha256,
            "runtime": artifact.runtime,
            "limitations": artifact.limitations,
            "models": [r.model_dump(exclude={"observations"}) for r in artifact.runs],
            "artifact_url": "https://github.com/RainCherb/ai-adoption-compass/blob/main/src/adoption_compass/data/evals/measured.json",
        },
    )


@router.get("/audit", response_model=EventsResponse, tags=["service"])
def audit(
    svc: ServicesDep,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    kind: str | None = None,
) -> EventsResponse:
    events = _storage(svc).list_events(limit, kind)
    return EventsResponse(events=[EventOut(**e.model_dump()) for e in events])


# --- приложение ----------------------------------------------------------------------------


def _mount_frontend(app: FastAPI, static_dir: Path | None) -> None:
    directory = static_dir or PACKAGED_STATIC
    index = directory / "index.html"
    if not index.is_file():

        @app.get("/", include_in_schema=False)
        def landing() -> HTMLResponse:
            return HTMLResponse(LANDING_HTML)

        return

    root = directory.resolve()
    if (directory / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=directory / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        candidate = (root / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(root):
            return FileResponse(candidate)
        return FileResponse(index)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    app = FastAPI(
        title="AI Adoption Compass API",
        version=__version__,
        summary="Оценка процессов и ROI, подбор моделей, защита данных, шаблоны промптов.",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.state.services = build_services(settings)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Не возвращаем исходные тексты/ключи и не сериализуем Infinity из ошибочного JSON.
        return JSONResponse(
            status_code=422,
            content={
                "detail": [
                    {"loc": list(error["loc"]), "msg": error["msg"], "type": error["type"]}
                    for error in exc.errors()
                ]
            },
        )

    if settings.demo_mode:
        app.add_middleware(DemoGuard)

    @app.middleware("http")
    async def security_headers(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if request.url.path not in DOCS_PATHS:
            response.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.path.startswith("/api/") and request.url.path not in DOCS_PATHS:
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    app.include_router(router)
    _mount_frontend(app, settings.static_dir)
    return app
