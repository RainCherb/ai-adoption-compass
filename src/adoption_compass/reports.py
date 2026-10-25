"""Отчёты по оценке: Markdown для руководителя и CSV для Excel."""

import csv
import io
from datetime import date

from .assessment import AssessmentResult, ProcessResult
from .domain import DEPLOYMENT_LABELS, QUADRANT_LABELS, TASK_LABELS, Severity, format_rub
from .featured_models import FeaturedModel

PREFERENCE_LABELS = {
    "balanced": "баланс",
    "cost": "минимальная цена",
    "quality": "максимальное качество",
    "safety": "максимальная безопасность",
}


def _tariff_line(profile: FeaturedModel) -> str:
    prices = profile.pricing
    if profile.currency == "RUB":
        price = f"{prices.input_per_mtok:g} / {prices.output_per_mtok:g} ₽ за 1 млн токенов с НДС"
    else:
        price = (
            f"${prices.input_per_mtok:g} / ${prices.output_per_mtok:g} за 1 млн токенов без налогов"
        )
    output = (
        f"выход до {profile.max_output_tokens:,}".replace(",", "\u00a0")
        if profile.max_output_tokens
        else "предел выхода не публикуется"
    )
    return (
        f"[{profile.name}]({profile.pricing_url}) — {price.replace('.', ',')} (вход / выход); "
        f"контекст {profile.context_label}, {output}; сверено {profile.reviewed_at:%d.%m.%Y}. "
        f"{profile.access_note}"
    )


def _months(value: float | None) -> str:
    return "не окупается" if value is None else f"{value:.1f} мес."


def _escape(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def _roadmap_row(index: int, p: ProcessResult) -> str:
    model = p.model.name if p.model else "—"
    return (
        f"| {index} | {_escape(p.name)} | {_escape(p.department)} | {_escape(model)} | "
        f"{p.hours_saved_month:.0f} | {format_rub(p.implementation_rub)} | "
        f"{_months(p.payback_months)} | {format_rub(p.net_horizon_rub)} |"
    )


def assessment_markdown(
    result: AssessmentResult,
    *,
    title: str = "Оценка процессов для внедрения ИИ",
    generated: date | None = None,
) -> str:
    s, a = result.summary, result.assumptions
    by_id = {p.id: p for p in result.processes}
    lines = [f"# {title}", ""]
    if generated:
        lines += [
            f"_Дата расчёта: {generated:%d.%m.%Y}. Горизонт оценки: {a.horizon_months} мес._",
            "",
        ]

    share = s.hours_saved_month / s.total_hours_month if s.total_hours_month else 0.0
    lines += [
        "## Главное",
        "",
        "| Показатель | Значение |",
        "| --- | --- |",
        f"| Оценено процессов | {s.processes_total} (без допустимой модели: {s.processes_blocked}) |",
        f"| Рекомендовано к внедрению | {s.recommended_count} |",
        f"| Высвобождается времени | {s.hours_saved_month:.0f} ч/мес (≈ {s.fte_equivalent:.1f} ставки, "
        f"{share:.0%} от всех трудозатрат списка) |",
        f"| Эффект в месяц | {format_rub(s.benefit_month_rub)} |",
        f"| Затраты в месяц (LLM и сопровождение) | {format_rub(s.cost_month_rub)} |",
        f"| Внедрение (разово) | {format_rub(s.implementation_rub)} |",
        f"| Окупаемость | {_months(s.payback_months)} |",
        f"| Чистый эффект за {a.horizon_months} мес. | {format_rub(s.net_horizon_rub)} |",
        f"| ROI за {a.horizon_months} мес. | {s.roi_pct:.0f}% |",
        "",
        "## Дорожная карта",
        "",
    ]
    if not result.roadmap:
        lines += ["Нет процессов, которые стоит внедрять при текущих допущениях.", ""]
    for wave in result.roadmap:
        lines += [
            f"### {wave.title}",
            "",
            f"Высвобождается {wave.hours_saved_month:.0f} ч/мес, внедрение "
            f"{format_rub(wave.implementation_rub)}, чистый эффект за {a.horizon_months} мес. — "
            f"{format_rub(wave.net_horizon_rub)}.",
            "",
            "| № | Процесс | Отдел | Модель | Экономия, ч/мес | Внедрение | Окупаемость | Эффект за период |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        lines += [_roadmap_row(i, by_id[pid]) for i, pid in enumerate(wave.process_ids, start=1)]
        lines.append("")

    lines += [
        "## Рейтинг всех процессов",
        "",
        "| № | Процесс | Тип задачи | Квадрант | Приоритет | Эффект | Простота | Пригодность |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for p in result.processes:
        lines.append(
            f"| {p.rank} | {_escape(p.name)} | {TASK_LABELS[p.task_type]} | {QUADRANT_LABELS[p.quadrant]} | "
            f"{p.priority:.0f} | {p.impact:.0f} | {p.ease:.0f} | {p.fit:.0f} |"
        )
    lines.append("")

    if any(p.model_options for p in result.processes):
        lines += [
            "## Модели по процессам: выбранная и самая дешёвая подходящая",
            "",
            "Качество 1–5 и итоговый балл — экспертные допущения, не измерения LLM. Рублёвые тарифы "
            "российских провайдеров — с НДС, долларовые — без налогов, пересчёт по курсу из допущений. "
            "Кэш, асинхронный режим и скидки не учтены; токены умножены на запас из допущений.",
            "",
            "| Процесс | Выбранная модель | ₽/мес | Самая дешёвая подходящая | ₽/мес | Подходят |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
        for process in result.processes:
            eligible = [o for o in process.model_options if o.eligible and o.cost]
            cheapest = min(eligible, key=lambda o: o.cost.total_rub if o.cost else 0, default=None)
            chosen = f"{process.model.name} (`{process.model.model_id}`)" if process.model else "—"
            chosen_rub = format_rub(process.model.cost.total_rub) if process.model else "—"
            alternative = cheapest.name if cheapest else "—"
            alternative_rub = (
                format_rub(cheapest.cost.total_rub) if cheapest and cheapest.cost else "—"
            )
            lines.append(
                f"| {_escape(process.name)} | {chosen} | {chosen_rub} | {alternative} | "
                f"{alternative_rub} | {len(eligible)} из {len(process.model_options)} |"
            )
        lines += ["", "### Тарифы и источники", ""]
        profiles = {o.model_id: o.profile for p in result.processes for o in p.model_options}
        lines += [f"- {_tariff_line(profile)}" for profile in profiles.values()]
        lines.append("")

    if result.portfolio_scenarios:
        lines += [
            "## Накопленный эффект: три сценария одного плана",
            "",
            "Внедрение списывается в месяце 0; далее постоянный ежемесячный поток. "
            "Поэтапный запуск, налоги и дисконтирование не учитываются.",
            "",
            "| Сценарий | Внедрение, месяц 0 | Чистый поток/мес | Эффект за период | Окупаемость |",
            "| --- | --- | --- | --- | --- |",
        ]
        for row in result.portfolio_scenarios:
            lines.append(
                f"| {row.label} | −{format_rub(row.implementation_rub)} | "
                f"{format_rub(row.net_month_rub)} | {format_rub(row.net_horizon_rub)} | "
                f"{_months(row.payback_months)} |"
            )
        lines.append("")

    deferred = [p for p in result.processes if p.wave is None]
    if deferred:
        lines += ["## Отложено и заблокировано", ""]
        for p in deferred:
            reason = next(
                (f.message for f in p.flags if f.code in {"no_compliant_model", "negative_roi"}),
                "Эффект не перекрывает затраты при текущих допущениях.",
            )
            lines.append(f"- **{p.name}** ({QUADRANT_LABELS[p.quadrant].lower()}): {reason}")
        lines.append("")

    if s.infrastructure:
        lines += ["## Инфраструктура self-hosted", ""]
        for line in s.infrastructure:
            names = ", ".join(by_id[pid].name for pid in line.process_ids)
            lines.append(
                f"- **{line.name}** — {format_rub(line.fixed_rub_month)}/мес "
                f"(блоков: {line.units}); обслуживает: {names}."
            )
        lines.append("")

    risks = [
        (p, f)
        for p in result.processes
        if p.wave is not None
        for f in p.flags
        if f.severity in {Severity.WARNING, Severity.CRITICAL}
    ]
    if risks:
        lines += ["## Риски и условия внедрения", ""]
        lines += [f"- **{p.name}:** {f.message}" for p, f in risks]
        lines.append("")

    lines += [
        "## Допущения расчёта",
        "",
        "| Параметр | Значение |",
        "| --- | --- |",
        f"| Горизонт | {a.horizon_months} мес. |",
        f"| Стоимость дня внедрения | {format_rub(a.implementation_day_rub)} |",
        f"| Сопровождение | {a.support_share_per_month:.0%} от стоимости внедрения в месяц |",
        f"| Запас токенов (повторы, контекст) | ×{a.llm_overhead:.2f} |",
        f"| Снижение ошибок | {a.error_reduction:.0%} |",
        f"| Курс USD/RUB | {a.usd_rub:.2f} ₽ |".replace(".", ","),
        f"| Приоритет модели | {PREFERENCE_LABELS.get(a.model_preference, a.model_preference)} |",
        f"| Время запросов к DeepSeek | {'вне пика' if a.deepseek_period == 'off_peak' else 'пиковые часы'} |",
        f"| Доступ к зарубежным API (аккаунт и оплата в поддерживаемой стране) | {'предполагается' if a.supported_region else 'нет — только российские облака'} |",
        f"| Обходные пути доступа к зарубежным моделям | {'разрешены' if a.allow_workarounds else 'не используются'} |",
        "",
        "> Расчёт — оценка на основе допущений, а не гарантия результата. "
        + (
            "Основные три тарифа сверены с официальными источниками; качество и эффект "
            "нуждаются в проверке на ваших задачах. Остальной каталог условный. "
            if result.data_status == "illustrative"
            else ""
        )
        + "Методика: docs/METHODOLOGY.md.",
        "",
    ]
    return "\n".join(lines)


CSV_COLUMNS = (
    "rank",
    "id",
    "name",
    "department",
    "task_type",
    "quadrant",
    "wave",
    "model",
    "deployment",
    "hours_per_month",
    "hours_saved_month",
    "savings_month_rub",
    "llm_cost_month_rub",
    "implementation_rub",
    "payback_months",
    "net_horizon_rub",
    "roi_pct",
    "fit",
    "impact",
    "ease",
    "priority",
    "model_api_id",
    "model_quality_expert",
    "llm_cost_month_usd",
    "tariff",
    "usd_rub",
)


def assessment_csv(result: AssessmentResult) -> str:
    """CSV с «;» и BOM — открывается в русском Excel без «кракозябр»."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\n")
    writer.writerow(CSV_COLUMNS)
    for p in result.processes:
        writer.writerow(
            [
                p.rank,
                p.id,
                p.name,
                p.department,
                p.task_type.value,
                p.quadrant.value,
                p.wave or "",
                p.model.name if p.model else "",
                DEPLOYMENT_LABELS[p.model.deployment] if p.model else "",
                p.hours_per_month,
                p.hours_saved_month,
                p.savings_month_rub,
                p.llm_cost_month_rub,
                p.implementation_rub,
                "" if p.payback_months is None else p.payback_months,
                p.net_horizon_rub,
                p.roi_pct,
                p.fit,
                p.impact,
                p.ease,
                p.priority,
                next(
                    (
                        o.profile.api_model
                        for o in p.model_options
                        if p.model and o.model_id == p.model.model_id
                    ),
                    "",
                ),
                p.model.quality if p.model else "",
                p.model.cost.total_usd if p.model and p.model.cost.total_usd is not None else "",
                p.model.cost.tariff if p.model else "",
                result.assumptions.usd_rub,
            ]
        )
    return "\ufeff" + buffer.getvalue()
