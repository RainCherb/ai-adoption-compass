"""Управляемые источники: снимок с происхождением, возрастом и отдельным ревью условий.

Сеть доступна только явной CLI-команде/скрипту. API читает готовый снимок.
Цены агрегатора никогда не подменяют цены прямого API или экспертные оценки каталога.
"""

import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal, Self
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .resources import load_yaml, read_data_text

ALLOWED_HOSTS = frozenset({"openrouter.ai", "ai.google.dev", "aistudio.yandex.ru"})
MAX_SOURCE_BYTES = 8_000_000


class SourceSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(pattern=r"^[a-z0-9-]+$")
    title: str
    url: str
    kind: Literal["openrouter", "manual"]
    max_age_days: int = Field(ge=1, le=90)
    model_ids: list[str] = Field(default_factory=list)

    @field_validator("url")
    @classmethod
    def _trusted_https(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or parsed.hostname not in ALLOWED_HOSTS
            or parsed.username
            or parsed.password
            or parsed.port not in {None, 443}
        ):
            raise ValueError("источник должен быть HTTPS на разрешённом официальном домене")
        return value


class SourceRegistry(BaseModel):
    version: Literal[1] = 1
    sources: list[SourceSpec]

    @model_validator(mode="after")
    def _unique(self) -> Self:
        if len({s.id for s in self.sources}) != len(self.sources):
            raise ValueError("повторяющийся идентификатор источника")
        return self


class PriceOffer(BaseModel):
    model_id: str
    name: str
    currency: Literal["USD"] = "USD"
    input_per_mtok: float = Field(ge=0, allow_inf_nan=False)
    output_per_mtok: float = Field(ge=0, allow_inf_nan=False)
    context_window: int = Field(gt=0)


class SourceSnapshot(BaseModel):
    source_id: str
    url: str
    fetched_at: datetime
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    status: Literal["machine_checked", "review_required", "unavailable", "reviewed"]
    reviewed_at: datetime | None = None
    reviewed_by: str | None = None
    offers: list[PriceOffer] = Field(default_factory=list)
    review_note: str


class SourceBundle(BaseModel):
    version: Literal[1] = 1
    snapshots: list[SourceSnapshot]


def load_registry(data_dir: Path | None = None) -> SourceRegistry:
    return SourceRegistry.model_validate(load_yaml("sources.yaml", data_dir))


def load_source_bundle(data_dir: Path | None = None) -> SourceBundle:
    return SourceBundle.model_validate_json(read_data_text("source-snapshots.json", data_dir))


def source_status(today: date, data_dir: Path | None = None) -> dict[str, Any]:
    specs = {s.id: s for s in load_registry(data_dir).sources}
    snapshots = {s.source_id: s for s in load_source_bundle(data_dir).snapshots}
    rows = []
    for spec in specs.values():
        snapshot = snapshots.get(spec.id)
        age = (today - snapshot.fetched_at.date()).days if snapshot else None
        # Снимок другого URL не считается достоверным после изменения реестра.
        valid = snapshot is not None and snapshot.url == spec.url
        rows.append(
            {
                **spec.model_dump(),
                "snapshot": snapshot.model_dump(mode="json") if valid and snapshot else None,
                "age_days": age if valid else None,
                "stale": not valid
                or snapshot is None
                or snapshot.status == "unavailable"
                or age is None
                or age < 0
                or age > spec.max_age_days,
            }
        )
    return {
        "sources": rows,
        "disclaimer": "Машинная проверка подтверждает только снимок API. Условия доступа проверяются человеком; тарифы агрегатора не являются прямыми тарифами разработчика. Экспертные оценки качества не меняются автоматически.",
    }


def parse_openrouter(raw: bytes, spec: SourceSpec) -> list[PriceOffer]:
    try:
        rows = json.loads(raw)["data"]
        if not isinstance(rows, list):
            raise ValueError("ожидался список моделей")
        indexed = {row["id"]: row for row in rows}
        offers = []
        for model_id in spec.model_ids:
            row = indexed[model_id]
            prices = row["pricing"]
            values = [Decimal(str(prices[key])) for key in ("prompt", "completion")]
            if any(not value.is_finite() or value < 0 for value in values):
                raise ValueError("некорректный тариф")
            offers.append(
                PriceOffer(
                    model_id=model_id,
                    name=row["name"],
                    input_per_mtok=float(values[0] * 1_000_000),
                    output_per_mtok=float(values[1] * 1_000_000),
                    context_window=row["context_length"],
                )
            )
        return offers
    except (ValueError, KeyError, TypeError, InvalidOperation) as exc:
        raise ValueError("Изменился формат источника или отсутствует выбранная модель") from exc


def refresh_sources(registry: SourceRegistry, client: httpx.Client) -> SourceBundle:
    snapshots = []
    for spec in registry.sources:
        raw = bytearray()
        try:
            # Redirect не разрешён: домен назначения должен оставаться в реестре.
            with client.stream("GET", spec.url, follow_redirects=False) as response:
                response.raise_for_status()
                for chunk in response.iter_bytes():
                    if len(raw) + len(chunk) > MAX_SOURCE_BYTES:
                        raise ValueError("ответ источника слишком большой")
                    raw.extend(chunk)
            offers = parse_openrouter(bytes(raw), spec) if spec.kind == "openrouter" else []
            status: Literal["machine_checked", "review_required", "unavailable"] = (
                "machine_checked" if spec.kind == "openrouter" else "review_required"
            )
            note = (
                "Тарифы за 1 млн токенов, USD, стандартный вход/выход без кеша, налогов и дополнительных услуг."
                if offers
                else "Страница получена. Содержание и доступность из региона требуют ручного ревью; получение HTTP 200 не подтверждает доступ из РФ."
            )
        except (httpx.HTTPError, ValueError):
            offers, status = [], "unavailable"
            note = "Источник недоступен или формат изменился. Не использовать для решений; требуется ручная проверка."
        snapshots.append(
            SourceSnapshot(
                source_id=spec.id,
                url=spec.url,
                fetched_at=datetime.now(UTC),
                content_sha256=hashlib.sha256(raw).hexdigest(),
                status=status,
                offers=offers,
                review_note=note,
            )
        )
    return SourceBundle(snapshots=snapshots)


def write_bundle(bundle: SourceBundle, target: Path) -> None:
    """Атомарная замена: прерванный refresh не оставляет частичный JSON."""
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    temporary.write_text(bundle.model_dump_json(indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)


def review_snapshot(
    bundle: SourceBundle, source_id: str, expected_sha256: str, reviewer: str, note: str
) -> SourceBundle:
    """Ревью привязано к точному хешу; нельзя подтвердить недоступный или другой снимок."""
    if not reviewer.strip() or len(note.strip()) < 10:
        raise ValueError("Укажите автора и содержательное заключение ревью (от 10 символов)")
    snapshots = [s.model_copy(deep=True) for s in bundle.snapshots]
    source = next((s for s in snapshots if s.source_id == source_id), None)
    if source is None or source.content_sha256 != expected_sha256 or source.status == "unavailable":
        raise ValueError("Нет доступного снимка с указанным идентификатором и SHA-256")
    source.status, source.reviewed_at = "reviewed", datetime.now(UTC)
    source.reviewed_by, source.review_note = reviewer.strip(), note.strip()
    return SourceBundle(snapshots=snapshots)
