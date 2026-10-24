"""Командная строка Compass: оценка процессов, подбор моделей, проверка данных, запросы, оценка качества."""

import json
import os
import sys
from dataclasses import replace
from datetime import date
from enum import StrEnum
from pathlib import Path
from typing import Annotated

import typer
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from . import __version__
from .advisor import Preference, Workload
from .assessment import AssessmentResult, ProcessResult
from .catalog import Catalog
from .config import Settings
from .csv_io import CsvFormatError, parse_processes_csv
from .domain import (
    ACTION_LABELS,
    DEPLOYMENT_LABELS,
    TASK_LABELS,
    Action,
    Deployment,
    Quadrant,
    Sensitivity,
    TaskType,
    format_rub,
)
from .evals import (
    SIM_PROFILES,
    EvalReport,
    KeywordBaselineProvider,
    OpenAICompatibleProvider,
    Pricing,
    Provider,
    SimulatedProvider,
    parse_items,
    reports_markdown,
    run_demo,
    run_eval,
    with_baseline_lift,
)
from .prompts import PromptRenderError, scaffold_prompt
from .reports import assessment_csv, assessment_markdown
from .resources import read_data_text
from .services import Services, build_services

app = typer.Typer(
    name="compass",
    help="AI Adoption Compass — где применить ИИ, какой моделью и как безопасно.",
    no_args_is_help=True,
    add_completion=False,
)
prompt_app = typer.Typer(help="Шаблоны запросов и линтер.", no_args_is_help=True)
eval_app = typer.Typer(help="Оценка качества моделей на ваших данных.", no_args_is_help=True)
catalog_app = typer.Typer(help="Каталог моделей.", no_args_is_help=True)
policy_app = typer.Typer(help="Политика обработки данных.", no_args_is_help=True)
data_app = typer.Typer(
    help="Файлы данных: каталог, политика, скоринг, шаблоны.", no_args_is_help=True
)
app.add_typer(prompt_app, name="prompt")
app.add_typer(eval_app, name="eval")
app.add_typer(catalog_app, name="catalog")
app.add_typer(policy_app, name="policy")
app.add_typer(data_app, name="data")

console = Console()
err = Console(stderr=True)

QUADRANT_STYLES = {
    Quadrant.QUICK_WIN: "bold green",
    Quadrant.STRATEGIC: "bold blue",
    Quadrant.FILL_IN: "cyan",
    Quadrant.POSTPONE: "yellow",
    Quadrant.BLOCKED: "bold red",
}
ACTION_STYLES = {Action.ALLOW: "green", Action.MASK: "yellow", Action.DENY: "bold red"}
QUADRANT_SHORT = {
    Quadrant.QUICK_WIN: "Быстрая победа",
    Quadrant.STRATEGIC: "Стратегический",
    Quadrant.FILL_IN: "Попутная задача",
    Quadrant.POSTPONE: "Отложить",
    Quadrant.BLOCKED: "Нет модели",
}


class OutputFormat(StrEnum):
    TABLE = "table"
    JSON = "json"
    MD = "md"


class FailOn(StrEnum):
    DENY = "deny"
    MASK = "mask"
    NEVER = "never"


def _services() -> Services:
    return build_services(Settings.from_env(), with_storage=False)


def _read_text(source: str | None) -> str:
    if source in (None, "-"):
        return sys.stdin.read()
    path = Path(source)
    if not path.is_file():
        raise typer.BadParameter(f"Файл не найден: {source}")
    return path.read_text(encoding="utf-8", errors="replace")


def _write_private(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    os.chmod(path, 0o600)


def _version_callback(value: bool) -> None:
    if value:
        typer.echo(f"compass {__version__}")
        raise typer.Exit


@app.callback()
def main(
    version: Annotated[
        bool,
        typer.Option(
            "--version", callback=_version_callback, is_eager=True, help="Показать версию."
        ),
    ] = False,
) -> None:
    """AI Adoption Compass."""


# --- оценка процессов -----------------------------------------------------------------------


def _short_model(process: ProcessResult, catalog: Catalog) -> str:
    if process.model is None:
        return "—"
    entry = catalog.get(process.model.model_id)
    suffix = " ⌂" if process.model.deployment is Deployment.SELF_HOSTED else ""
    return f"{entry.family}{suffix}"


def _print_assessment(result: AssessmentResult, catalog: Catalog) -> None:
    s, a = result.summary, result.assumptions
    kpi = Table.grid(padding=(0, 2))
    kpi.add_row(
        "Процессов оценено",
        f"[bold]{s.processes_total}[/]  (рекомендовано: [green]{s.recommended_count}[/], без модели: [red]{s.processes_blocked}[/])",
    )
    kpi.add_row(
        "Высвобождается",
        f"[bold]{s.hours_saved_month:.0f} ч/мес[/]  (≈ {s.fte_equivalent:.1f} ставки)",
    )
    kpi.add_row(
        "Эффект / затраты в месяц",
        f"{format_rub(s.benefit_month_rub)} / {format_rub(s.cost_month_rub)}",
    )
    kpi.add_row("Внедрение (разово)", format_rub(s.implementation_rub))
    payback = "не окупается" if s.payback_months is None else f"{s.payback_months:.1f} мес."
    kpi.add_row("Окупаемость", f"[bold]{payback}[/]")
    kpi.add_row(
        f"Чистый эффект за {a.horizon_months} мес.",
        f"[bold green]{format_rub(s.net_horizon_rub)}[/]  (ROI {s.roi_pct:.0f}%)",
    )
    console.print(Panel(kpi, title="Итоги портфеля", border_style="green"))

    table = Table(header_style="bold", box=box.SIMPLE_HEAD, padding=(0, 1), expand=True)
    right = {"№", "ч/мес", "Внедрение", "Окуп., мес", "Эффект"}
    for column in (
        "№",
        "Процесс",
        "Квадрант",
        "Модель",
        "ч/мес",
        "Внедрение",
        "Окуп., мес",
        "Эффект",
    ):
        table.add_column(
            column,
            justify="right" if column in right else "left",
            ratio=4 if column == "Процесс" else None,
            no_wrap=column != "Процесс",
        )
    for p in result.processes:
        payback = "—" if p.payback_months is None else f"{p.payback_months:.1f}"
        table.add_row(
            str(p.rank),
            p.name,
            Text(QUADRANT_SHORT[p.quadrant], style=QUADRANT_STYLES[p.quadrant]),
            _short_model(p, catalog),
            f"{p.hours_saved_month:.0f}",
            format_rub(p.implementation_rub),
            payback,
            format_rub(p.net_horizon_rub) if p.feasible else "—",
        )
    console.print(table)
    for warning in result.warnings:
        console.print(f"[yellow]![/] {warning}")


@app.command()
def assess(
    file: Annotated[
        Path, typer.Argument(help="CSV со списком процессов.", exists=True, dir_okay=False)
    ],
    fmt: Annotated[
        OutputFormat, typer.Option("--format", "-f", help="Формат вывода.")
    ] = OutputFormat.TABLE,
    out: Annotated[
        Path | None, typer.Option("--out", "-o", help="Сохранить результат в файл.")
    ] = None,
    horizon: Annotated[
        int | None, typer.Option(min=1, max=60, help="Горизонт оценки, мес.")
    ] = None,
    hourly: Annotated[
        float | None, typer.Option(min=1, help="Стоимость часа по умолчанию, ₽.")
    ] = None,
    workarounds: Annotated[
        bool, typer.Option(help="Допускать обходные пути доступа к зарубежным моделям.")
    ] = False,
) -> None:
    """Оценить процессы: пригодность для ИИ, ROI, приоритеты и дорожная карта."""
    svc = _services()
    try:
        parsed = parse_processes_csv(file.read_bytes())
    except CsvFormatError as exc:
        err.print(f"[red]Ошибка файла:[/] {exc}")
        raise typer.Exit(1) from exc
    for row in parsed.errors:
        err.print(f"[yellow]Строка {row.line}:[/] {row.message}")
    if not parsed.processes:
        err.print("[red]Нет ни одной корректной строки.[/]")
        raise typer.Exit(1)
    overrides: dict[str, object] = {}
    if horizon:
        overrides["horizon_months"] = horizon
    if hourly:
        overrides["default_hourly_cost_rub"] = hourly
    if workarounds:
        overrides["allow_workarounds"] = True
    result = svc.engine.assess(parsed.processes, overrides)

    if fmt is OutputFormat.JSON:
        payload = result.model_dump_json(indent=2)
    elif fmt is OutputFormat.MD:
        payload = assessment_markdown(result, generated=date.today())
    else:
        if out:
            payload = assessment_csv(result)
        else:
            _print_assessment(result, svc.catalog)
            return
    if out:
        out.write_text(payload, encoding="utf-8")
        err.print(f"[green]Сохранено:[/] {out}")
    else:
        typer.echo(payload)


# --- подбор моделей -------------------------------------------------------------------------


@app.command()
def advise(
    task: Annotated[TaskType, typer.Option("--task", help="Тип задачи.")],
    requests: Annotated[int, typer.Option("--requests", min=1, help="Запросов в месяц.")],
    tokens_in: Annotated[int, typer.Option(min=1, help="Входных токенов на запрос.")] = 1000,
    tokens_out: Annotated[int, typer.Option(min=0, help="Выходных токенов на запрос.")] = 300,
    sensitivity: Annotated[
        Sensitivity, typer.Option(help="Категория данных.")
    ] = Sensitivity.INTERNAL,
    min_quality: Annotated[int, typer.Option(min=1, max=5, help="Требуемое качество 1–5.")] = 3,
    budget: Annotated[float | None, typer.Option(min=1, help="Бюджет в месяц, ₽.")] = None,
    vision: Annotated[bool, typer.Option(help="Нужна работа с изображениями.")] = False,
    tools: Annotated[bool, typer.Option(help="Нужен вызов функций.")] = False,
    self_host: Annotated[bool, typer.Option(help="Только self-hosted.")] = False,
    workarounds: Annotated[bool, typer.Option(help="Допускать обходные пути доступа.")] = False,
    prefer: Annotated[Preference, typer.Option(help="Что важнее.")] = Preference.BALANCED,
    top: Annotated[int, typer.Option(min=1, max=20)] = 5,
    show_excluded: Annotated[
        bool, typer.Option(help="Показать исключённые модели и причины.")
    ] = False,
    fmt: Annotated[OutputFormat, typer.Option("--format", "-f")] = OutputFormat.TABLE,
) -> None:
    """Подобрать модель под задачу, данные и бюджет."""
    svc = _services()
    workload = Workload(
        task_type=task,
        data_sensitivity=sensitivity,
        requests_per_month=requests,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        min_quality=min_quality,
        monthly_budget_rub=budget,
        needs_vision=vision,
        needs_tool_calling=tools,
        must_self_host=self_host,
        allow_workarounds=workarounds,
        prefer=prefer,
    )
    result = svc.advisor.recommend(workload, top=top)
    if fmt is OutputFormat.JSON:
        typer.echo(result.model_dump_json(indent=2))
        return
    console.print(
        f"[bold]{TASK_LABELS[task]}[/] · {requests:,} запросов/мес".replace(",", "\u00a0")
    )
    if result.recommendations:
        table = Table(header_style="bold")
        for column in ("№", "Модель", "Размещение", "Оценка", "Кач.", "₽/мес", "Условия"):
            table.add_column(column)
        for r in result.recommendations:
            conditions = "; ".join(r.cons[:2]) or "—"
            table.add_row(
                str(r.rank),
                r.name,
                DEPLOYMENT_LABELS[r.deployment],
                f"{r.score:.1f}",
                f"{r.quality}/5",
                format_rub(r.cost.total_rub),
                conditions,
            )
        console.print(table)
    for note in result.notes:
        console.print(f"[yellow]•[/] {note}")
    if show_excluded and result.excluded:
        console.print("\n[bold]Исключены:[/]")
        for e in result.excluded:
            console.print(f"  [red]✗[/] {e.name}: {'; '.join(e.reasons)}")


# --- безопасность данных --------------------------------------------------------------------


@app.command()
def scan(
    source: Annotated[str | None, typer.Argument(help="Файл или «-» для stdin.")] = None,
    target: Annotated[
        Deployment, typer.Option("--target", "-t", help="Куда планируется отправка.")
    ] = Deployment.FOREIGN_CLOUD,
    declared: Annotated[
        Sensitivity, typer.Option(help="Заявленная категория данных.")
    ] = Sensitivity.INTERNAL,
    fail_on: Annotated[
        FailOn, typer.Option(help="При каком решении завершаться с кодом 2.")
    ] = FailOn.DENY,
    fmt: Annotated[OutputFormat, typer.Option("--format", "-f")] = OutputFormat.TABLE,
) -> None:
    """Найти персональные данные и секреты; код 2 — отправка по политике недопустима."""
    svc = _services()
    report = svc.guard.analyze(_read_text(source), declared).report
    decision = report.decision_for(target)
    if fmt is OutputFormat.JSON:
        payload = report.model_dump(mode="json")
        payload.pop("masked_text")
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        if report.findings:
            table = Table(header_style="bold")
            for column in ("Тип", "Что найдено", "Фрагмент", "Уверенность"):
                table.add_column(column)
            for f in report.findings:
                style = "bold red" if f.is_secret else None
                table.add_row(f.kind, f.label, Text(f.preview), f.confidence, style=style)
            console.print(table)
        else:
            console.print("[green]Чувствительных данных не найдено.[/]")
        for d in report.decisions:
            mark = "→" if d.target is target else " "
            console.print(
                f"{mark} {DEPLOYMENT_LABELS[d.target]:<28} "
                f"[{ACTION_STYLES[d.action]}]{ACTION_LABELS[d.action]}[/]"
            )
        console.print(Text(decision.reasons[0]))
    blocked = decision.action is Action.DENY or (
        fail_on is FailOn.MASK and decision.action is Action.MASK
    )
    if fail_on is not FailOn.NEVER and blocked:
        raise typer.Exit(2)


@app.command()
def mask(
    source: Annotated[str | None, typer.Argument(help="Файл или «-» для stdin.")] = None,
    out: Annotated[
        Path | None, typer.Option("--out", "-o", help="Куда записать обезличенный текст.")
    ] = None,
    mapping: Annotated[
        Path | None, typer.Option(help="Куда сохранить соответствия меток (JSON, права 600).")
    ] = None,
) -> None:
    """Заменить персональные данные и секреты метками вроде [PHONE_1]."""
    svc = _services()
    result = svc.guard.mask(_read_text(source))
    if out:
        out.write_text(result.text, encoding="utf-8")
    else:
        typer.echo(result.text)
    if mapping:
        _write_private(mapping, json.dumps(result.mapping, ensure_ascii=False, indent=2))
    summary = ", ".join(f"{tag}×{n}" for tag, n in result.counts.items()) or "ничего не найдено"
    err.print(f"[green]Обезличено:[/] {summary}")
    if mapping:
        err.print(
            f"[yellow]Файл соответствий содержит исходные данные — не передавайте его в сервисы:[/] {mapping}"
        )


@app.command()
def unmask(
    source: Annotated[str | None, typer.Argument(help="Файл с ответом модели или «-».")] = None,
    mapping: Annotated[
        Path, typer.Option(help="JSON с соответствиями меток.", exists=True, dir_okay=False)
    ] = Path("mapping.json"),
    out: Annotated[Path | None, typer.Option("--out", "-o")] = None,
) -> None:
    """Вернуть исходные значения вместо меток в ответе модели."""
    svc = _services()
    restored = svc.guard.unmask(_read_text(source), json.loads(mapping.read_text(encoding="utf-8")))
    if out:
        out.write_text(restored, encoding="utf-8")
    else:
        typer.echo(restored)


@policy_app.command("handout")
def policy_handout(
    out: Annotated[
        Path | None, typer.Option("--out", "-o", help="Сохранить памятку в файл.")
    ] = None,
) -> None:
    """Сформировать памятку для сотрудников из политики данных."""
    text = _services().policy.handout_markdown()
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")
        err.print(f"[green]Сохранено:[/] {out}")
    else:
        typer.echo(text)


# --- шаблоны запросов -----------------------------------------------------------------------


@prompt_app.command("list")
def prompt_list(
    department: Annotated[str | None, typer.Option(help="Фильтр по отделу.")] = None,
) -> None:
    """Список шаблонов."""
    svc = _services()
    table = Table(header_style="bold")
    for column in ("ID", "Название", "Отдел", "Тип задачи", "Данные"):
        table.add_column(column)
    for t in svc.library.list_templates(department=department):
        table.add_row(t.id, t.title, t.department, TASK_LABELS[t.task_type], t.sensitivity.value)
    console.print(table)


@prompt_app.command("show")
def prompt_show(template_id: str) -> None:
    """Показать шаблон, поля и чек-лист проверки ответа."""
    svc = _services()
    try:
        t = svc.library.get(template_id)
    except KeyError:
        err.print(f"[red]Шаблон не найден:[/] {template_id}")
        raise typer.Exit(1) from None
    console.print(Panel(Text(t.body), title=t.title, subtitle=t.description))
    for v in t.variables:
        required = "обязательное" if v.required and v.default is None else "необязательное"
        console.print(f"  [bold]{v.name}[/] — {v.label} ({required})")
    console.print("\n[bold]Как проверить ответ:[/]")
    for item in t.checklist:
        console.print(f"  ☐ {item}")


@prompt_app.command("render")
def prompt_render(
    template_id: str,
    values: Annotated[
        list[str] | None, typer.Option("--set", "-s", help="Значение: имя=текст.")
    ] = None,
    files: Annotated[
        list[str] | None, typer.Option("--file", help="Значение из файла: имя=путь.")
    ] = None,
) -> None:
    """Подставить значения в шаблон."""
    svc = _services()
    data: dict[str, str] = {}
    for item in values or []:
        key, sep, value = item.partition("=")
        if not sep:
            raise typer.BadParameter(f"Ожидается имя=значение: {item}")
        data[key] = value
    for item in files or []:
        key, sep, path = item.partition("=")
        if not sep:
            raise typer.BadParameter(f"Ожидается имя=путь: {item}")
        data[key] = _read_text(path)
    try:
        rendered = svc.library.render(template_id, data)
    except KeyError:
        err.print(f"[red]Шаблон не найден:[/] {template_id}")
        raise typer.Exit(1) from None
    except PromptRenderError as exc:
        for message in exc.errors:
            err.print(f"[red]✗[/] {message}")
        raise typer.Exit(1) from exc
    typer.echo(rendered.text)
    for warning in rendered.warnings:
        err.print(f"[yellow]![/] {warning}")


@prompt_app.command("lint")
def prompt_lint(
    source: Annotated[str | None, typer.Argument(help="Файл с запросом или «-».")] = None,
    min_score: Annotated[int, typer.Option(min=0, max=100, help="Порог для кода возврата 1.")] = 0,
) -> None:
    """Оценить качество запроса по чек-листу."""
    svc = _services()
    result = svc.linter.lint(_read_text(source))
    color = {"A": "green", "B": "cyan", "C": "yellow", "D": "red"}[result.grade]
    console.print(
        f"Оценка: [{color} bold]{result.score}/100 ({result.grade})[/] · слов: {result.words}"
    )
    for check in result.checks:
        console.print(f"  {'[green]✓[/]' if check.passed else '[red]✗[/]'} {check.label}")
    for suggestion in result.suggestions:
        console.print(f"[yellow]•[/] {suggestion}")
    if result.score < min_score:
        raise typer.Exit(1)


@prompt_app.command("scaffold")
def prompt_scaffold(
    task: Annotated[str, typer.Argument(help="Что нужно сделать, одним предложением.")],
    role: Annotated[str | None, typer.Option(help="Роль модели.")] = None,
) -> None:
    """Каркас хорошего запроса."""
    typer.echo(scaffold_prompt(task, role))


# --- оценка качества моделей ----------------------------------------------------------------


def _print_eval(reports: list[EvalReport]) -> None:
    table = Table(header_style="bold")
    for column in ("Модель", "Точность", "F1", "Невал.", "p50 мс", "p95 мс", "₽", "Δ baseline"):
        table.add_column(column, justify="left" if column == "Модель" else "right")
    for r in sorted(reports, key=lambda x: -x.metrics.accuracy):
        lift = "—" if r.accuracy_lift is None else f"{r.accuracy_lift * 100:+.1f} п.п."
        cost = "—" if r.cost_rub is None else f"{r.cost_rub:.2f}"
        table.add_row(
            r.provider,
            f"{r.metrics.accuracy:.1%}",
            f"{r.metrics.macro_f1:.3f}",
            str(r.metrics.invalid),
            f"{r.latency.p50_ms:.0f}",
            f"{r.latency.p95_ms:.0f}",
            cost,
            lift,
        )
    console.print(table)


@eval_app.command("demo")
def eval_demo() -> None:
    """Офлайн-сравнение baseline и симулируемых моделей на встроенном наборе."""
    svc = _services()
    _print_eval(run_demo(svc.eval_task, svc.eval_items))
    console.print("[dim]Профили sim:* — детерминированный симулятор, не реальные модели.[/]")


@eval_app.command("run")
def eval_run(
    provider: Annotated[
        list[str] | None,
        typer.Option("--provider", "-p", help="baseline, sim:economy|balanced|flagship или api."),
    ] = None,
    dataset: Annotated[
        Path | None, typer.Option(help="JSONL {id, text, label}; по умолчанию встроенный набор.")
    ] = None,
    base_url: Annotated[
        str | None, typer.Option(help="Адрес OpenAI-совместимого API (для provider=api).")
    ] = None,
    model: Annotated[
        str | None, typer.Option(help="Идентификатор модели (для provider=api).")
    ] = None,
    api_key_env: Annotated[
        str, typer.Option(help="Переменная окружения с ключом API.")
    ] = "OPENAI_API_KEY",
    catalog_id: Annotated[
        str | None, typer.Option(help="Запись каталога, из которой взять цены.")
    ] = None,
    price_in: Annotated[float | None, typer.Option(help="Цена входа, ₽ за 1 млн токенов.")] = None,
    price_out: Annotated[
        float | None, typer.Option(help="Цена выхода, ₽ за 1 млн токенов.")
    ] = None,
    fmt: Annotated[OutputFormat, typer.Option("--format", "-f")] = OutputFormat.TABLE,
    out: Annotated[Path | None, typer.Option("--out", "-o")] = None,
) -> None:
    """Прогнать модели на размеченном наборе: точность, задержка, стоимость."""
    svc = _services()
    task = svc.eval_task
    items = parse_items(dataset.read_text(encoding="utf-8"), task) if dataset else svc.eval_items
    providers: list[Provider] = []
    for name in provider or ["baseline", "sim:flagship"]:
        if name == "baseline":
            providers.append(KeywordBaselineProvider(task))
        elif name.startswith("sim:"):
            try:
                providers.append(SimulatedProvider(name.removeprefix("sim:"), task, items))
            except ValueError as exc:
                raise typer.BadParameter(f"{exc}. Доступно: {', '.join(SIM_PROFILES)}") from exc
        elif name == "api":
            if not base_url or not model:
                raise typer.BadParameter("Для provider=api нужны --base-url и --model")
            pricing = None
            if catalog_id:
                entry = svc.catalog.get(catalog_id)
                fx = svc.advisor.usd_rub if entry.pricing.currency == "USD" else 1.0
                pricing = Pricing(
                    entry.pricing.input_per_mtok * fx, entry.pricing.output_per_mtok * fx
                )
            elif price_in is not None and price_out is not None:
                pricing = Pricing(price_in, price_out)
            providers.append(
                OpenAICompatibleProvider(
                    base_url,
                    model,
                    os.environ.get(api_key_env),
                    name=f"api:{model}",
                    pricing=pricing,
                )
            )
        else:
            raise typer.BadParameter(f"Неизвестный провайдер: {name}")
    reports = with_baseline_lift([run_eval(p, task, items) for p in providers])
    if fmt is OutputFormat.JSON:
        payload = json.dumps(
            [r.model_dump(mode="json") for r in reports], ensure_ascii=False, indent=2
        )
    elif fmt is OutputFormat.MD:
        payload = reports_markdown(reports, task)
    else:
        _print_eval(reports)
        return
    if out:
        out.write_text(payload, encoding="utf-8")
        err.print(f"[green]Сохранено:[/] {out}")
    else:
        typer.echo(payload)


# --- каталог --------------------------------------------------------------------------------


@catalog_app.command("check")
def catalog_check(
    max_age_days: Annotated[
        int, typer.Option(min=1, help="Максимальный возраст записи, дней.")
    ] = 90,
    strict: Annotated[bool, typer.Option(help="Код 1, если есть устаревшие записи.")] = False,
) -> None:
    """Проверить, не устарели ли цены и оценки в каталоге моделей."""
    svc = _services()
    stale = svc.catalog.stale_entries(svc.settings.current_date, max_age_days)
    console.print(
        f"Каталог на {svc.catalog.as_of:%d.%m.%Y}: {len(svc.catalog.models)} моделей, "
        f"статус данных — [bold]{svc.catalog.data_status}[/]."
    )
    if not stale:
        console.print(f"[green]Все записи проверялись не более {max_age_days} дней назад.[/]")
        return
    for s in stale:
        console.print(
            f"[yellow]![/] {s.name}: проверено {s.reviewed_at:%d.%m.%Y} ({s.age_days} дн. назад)"
        )
    if strict:
        raise typer.Exit(1)


@catalog_app.command("list")
def catalog_list() -> None:
    """Список моделей каталога."""
    svc = _services()
    table = Table(header_style="bold")
    for column in ("ID", "Модель", "Размещение", "Доступ из РФ", "Контекст"):
        table.add_column(column)
    for m in svc.catalog.models:
        table.add_row(
            m.id,
            m.name,
            DEPLOYMENT_LABELS[m.deployment],
            "напрямую" if m.ru_access.value == "direct" else "обходные пути",
            f"{m.context_window:,}".replace(",", "\u00a0"),
        )
    console.print(table)


DATA_FILES = (
    "catalog.yaml",
    "policy.yaml",
    "scoring.yaml",
    "prompts.yaml",
    "evals/routing.yaml",
    "evals/routing.jsonl",
    "samples/processes.csv",
)


@data_app.command("export")
def data_export(
    target: Annotated[Path, typer.Argument(help="Папка, куда скопировать файлы данных.")],
    force: Annotated[bool, typer.Option(help="Перезаписать существующие файлы.")] = False,
) -> None:
    """Скопировать встроенные данные, чтобы настроить их под компанию (COMPASS_DATA_DIR)."""
    existing = [name for name in DATA_FILES if (target / name).exists()]
    if existing and not force:
        err.print(f"[red]Файлы уже существуют:[/] {', '.join(existing)}. Добавьте --force.")
        raise typer.Exit(1)
    for name in DATA_FILES:
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(read_data_text(name), encoding="utf-8")
    console.print(f"[green]Скопировано файлов:[/] {len(DATA_FILES)} → {target}")
    console.print(f"Используйте свои данные: [bold]export COMPASS_DATA_DIR={target}[/]")


# --- сервер, MCP, демо ----------------------------------------------------------------------


@app.command()
def serve(
    host: Annotated[
        str, typer.Option(help="Адрес. Для доступа из сети укажите 0.0.0.0 осознанно.")
    ] = "127.0.0.1",
    port: Annotated[int, typer.Option(min=1, max=65535)] = 8000,
    db: Annotated[Path | None, typer.Option(help="Файл SQLite.")] = None,
    static_dir: Annotated[Path | None, typer.Option(help="Папка собранного фронтенда.")] = None,
) -> None:
    """Запустить REST API и веб-интерфейс."""
    import uvicorn

    from .api import create_app

    settings = Settings.from_env()
    if db:
        settings = replace(settings, db_path=db)
    if static_dir:
        settings = replace(settings, static_dir=static_dir)
    uvicorn.run(create_app(settings), host=host, port=port, log_level="info")


@app.command()
def mcp(
    root: Annotated[
        Path | None, typer.Option(help="Папка, доступная файловым инструментам.")
    ] = None,
) -> None:
    """Запустить MCP-сервер (stdio) для Claude Code, Codex, OpenCode, Kiro."""
    from .mcp_server import create_mcp_server

    settings = Settings.from_env()
    if root:
        settings = replace(settings, mcp_root=root)
    create_mcp_server(build_services(settings, with_storage=False)).run()


DEMO_SAMPLE = (
    "Клиент Иванов Иван Иванович (тел. +7 912 345-67-89, ivan@example.ru) "
    "просит вернуть деньги за заказ."
)


def demo_assessment(svc: Services) -> None:
    parsed = parse_processes_csv(read_data_text("samples/processes.csv"))
    _print_assessment(svc.engine.assess(parsed.processes), svc.catalog)


def demo_safety(svc: Services) -> None:
    analysis = svc.guard.analyze(DEMO_SAMPLE)
    console.print(Text(f"Исходный текст:  {DEMO_SAMPLE}"))
    console.print(Text(f"Обезличенный:    {analysis.masked.text}"))
    for d in analysis.report.decisions:
        console.print(
            f"  {DEPLOYMENT_LABELS[d.target]:<28} [{ACTION_STYLES[d.action]}]{ACTION_LABELS[d.action]}[/]"
        )


def demo_prompt_quality(svc: Services) -> None:
    good = svc.library.render("ticket-triage", {"ticket_text": "Не работает вход"}).text
    for label, text in (
        ("Запрос «Напиши про ИИ»", "Напиши про ИИ"),
        ("Шаблон ticket-triage из библиотеки", good),
    ):
        lint = svc.linter.lint(text)
        console.print(f"{label:<40}→ {lint.score}/100 ({lint.grade})")


def demo_evals(svc: Services) -> None:
    _print_eval(run_demo(svc.eval_task, svc.eval_items))


@app.command()
def demo() -> None:
    """Показать все возможности на демо-данных вымышленной компании."""
    svc = _services()
    console.rule("[bold]1. Где ИИ даст эффект: оценка 18 процессов")
    demo_assessment(svc)
    console.rule("[bold]2. Безопасность: что можно отправлять в нейросеть")
    demo_safety(svc)
    console.rule("[bold]3. Качество запроса")
    demo_prompt_quality(svc)
    console.rule("[bold]4. Оценка качества моделей (офлайн-симуляция)")
    demo_evals(svc)
