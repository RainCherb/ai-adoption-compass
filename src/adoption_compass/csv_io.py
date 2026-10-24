"""Разбор CSV со списком процессов: разделители «,» «;» «\\t», UTF-8 и cp1251, русские заголовки."""

import csv
import io

from pydantic import BaseModel, ValidationError

from .assessment import Process
from .domain import SENSITIVITY_LABELS, TASK_LABELS, Sensitivity, TaskType, coerce_enum

MAX_ROWS = 2000
REQUIRED_COLUMNS = ("name", "task_type", "runs_per_month", "minutes_per_run")

HEADER_ALIASES: dict[str, str] = {
    "код": "id",
    "название": "name",
    "наименование": "name",
    "процесс": "name",
    "отдел": "department",
    "подразделение": "department",
    "департамент": "department",
    "тип задачи": "task_type",
    "тип": "task_type",
    "запусков в месяц": "runs_per_month",
    "операций в месяц": "runs_per_month",
    "объём в месяц": "runs_per_month",
    "объем в месяц": "runs_per_month",
    "минут на запуск": "minutes_per_run",
    "минут на операцию": "minutes_per_run",
    "стоимость часа": "hourly_cost_rub",
    "стоимость часа, руб": "hourly_cost_rub",
    "доля ошибок": "error_rate",
    "стоимость ошибки": "error_cost_rub",
    "стандартизация": "standardization",
    "оцифрованность": "digital_readiness",
    "риск": "risk_level",
    "уровень риска": "risk_level",
    "категория данных": "data_sensitivity",
    "чувствительность данных": "data_sensitivity",
    "только self-hosted": "must_self_host",
    "свой контур": "must_self_host",
    "входных токенов": "tokens_in",
    "выходных токенов": "tokens_out",
}

KNOWN_COLUMNS = set(Process.model_fields) | set(HEADER_ALIASES.values())
_TRUE = {"1", "true", "yes", "y", "да", "д", "истина", "+"}
_FALSE = {"0", "false", "no", "n", "нет", "н", "ложь", "-", ""}


class CsvFormatError(ValueError):
    """Файл нельзя разобрать целиком (нет заголовка, не хватает обязательных колонок)."""


class RowError(BaseModel):
    line: int
    message: str


class CsvParseResult(BaseModel):
    processes: list[Process]
    errors: list[RowError]
    delimiter: str


def decode_csv_bytes(raw: bytes) -> str:
    """UTF-8 (с BOM или без), иначе cp1251 — так сохраняет «CSV» русский Excel."""
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1251")


def _to_number(raw: str) -> float:
    return float(raw.strip().replace("\u00a0", "").replace(" ", "").replace(",", "."))


def _to_share(raw: str) -> float:
    """Доля 0–1 или проценты («8%», «8»)."""
    text = raw.strip()
    value = _to_number(text.rstrip("%"))
    return value / 100 if text.endswith("%") or value > 1 else value


def _to_bool(raw: str) -> bool:
    text = raw.strip().lower()
    if text in _TRUE:
        return True
    if text in _FALSE:
        return False
    raise ValueError(f"не удалось разобрать «{raw}» как да/нет")


def _canonical(header: str) -> str:
    key = header.strip().lower()
    return HEADER_ALIASES.get(key, key.replace(" ", "_"))


def _convert(field: str, raw: str) -> object:
    if field in {"runs_per_month", "tokens_in", "tokens_out"}:
        return round(_to_number(raw))
    if field in {"standardization", "digital_readiness", "risk_level"}:
        return round(_to_number(raw))
    if field in {"minutes_per_run", "hourly_cost_rub", "error_cost_rub"}:
        return _to_number(raw)
    if field == "error_rate":
        return _to_share(raw)
    if field == "task_type":
        return coerce_enum(TaskType, raw, TASK_LABELS)
    if field == "data_sensitivity":
        return coerce_enum(Sensitivity, raw, SENSITIVITY_LABELS)
    if field == "must_self_host":
        return _to_bool(raw)
    return raw.strip()


def parse_processes_csv(content: str | bytes) -> CsvParseResult:
    text = decode_csv_bytes(content) if isinstance(content, bytes) else content
    text = text.lstrip("\ufeff")
    if not text.strip():
        raise CsvFormatError("Файл пустой")
    first_line = text.splitlines()[0]
    delimiter = max((";", ",", "\t"), key=first_line.count)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    try:
        header = next(reader)
    except StopIteration as exc:  # pragma: no cover - защищено проверкой выше
        raise CsvFormatError("Файл пустой") from exc

    columns = [_canonical(h) for h in header]
    missing = [c for c in REQUIRED_COLUMNS if c not in columns]
    if missing:
        raise CsvFormatError(
            "Не хватает обязательных колонок: "
            + ", ".join(missing)
            + ". Ожидаются: "
            + ", ".join(REQUIRED_COLUMNS)
        )

    processes: list[Process] = []
    errors: list[RowError] = []
    for line, row in enumerate(reader, start=2):
        if not any(cell.strip() for cell in row):
            continue
        if len(processes) + len(errors) >= MAX_ROWS:
            raise CsvFormatError(f"Слишком много строк: максимум {MAX_ROWS}")
        values: dict[str, object] = {}
        problems: list[str] = []
        for column, cell in zip(columns, row, strict=False):
            if column not in KNOWN_COLUMNS:
                continue
            if not cell.strip() and column not in {"must_self_host"}:
                continue
            try:
                values[column] = _convert(column, cell)
            except ValueError as exc:
                problems.append(f"{column}: {exc}")
        if problems:
            errors.append(RowError(line=line, message="; ".join(problems)))
            continue
        values.setdefault("id", f"P{len(processes) + len(errors) + 1:02d}")
        try:
            processes.append(Process.model_validate(values))
        except ValidationError as exc:
            detail = "; ".join(
                f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors()
            )
            errors.append(RowError(line=line, message=detail))
    return CsvParseResult(processes=processes, errors=errors, delimiter=delimiter)
