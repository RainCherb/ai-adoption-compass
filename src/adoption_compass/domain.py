"""Предметная область: перечисления, русские подписи и разбор значений."""

from collections.abc import Mapping
from enum import StrEnum
from typing import TypeVar


class TaskType(StrEnum):
    """Тип задачи, которую передают нейросети."""

    CLASSIFICATION = "classification"
    EXTRACTION = "extraction"
    SUMMARIZATION = "summarization"
    DRAFTING = "drafting"
    QA_SEARCH = "qa_search"
    TRANSLATION = "translation"
    ANALYSIS = "analysis"
    CODE = "code"
    DECISION_SUPPORT = "decision_support"


class Sensitivity(StrEnum):
    """Категория данных по чувствительности (по возрастанию)."""

    PUBLIC = "public"
    INTERNAL = "internal"
    CONFIDENTIAL = "confidential"
    PERSONAL = "personal"

    @property
    def rank(self) -> int:
        return SENSITIVITY_ORDER.index(self)


SENSITIVITY_ORDER: tuple[Sensitivity, ...] = (
    Sensitivity.PUBLIC,
    Sensitivity.INTERNAL,
    Sensitivity.CONFIDENTIAL,
    Sensitivity.PERSONAL,
)


def max_sensitivity(*levels: Sensitivity) -> Sensitivity:
    """Самая строгая категория из переданных."""
    return max(levels, key=lambda level: level.rank)


class Deployment(StrEnum):
    """Где физически работает модель."""

    RU_CLOUD = "ru_cloud"
    FOREIGN_CLOUD = "foreign_cloud"
    SELF_HOSTED = "self_hosted"


class RuAccess(StrEnum):
    """Доступность сервиса из РФ."""

    DIRECT = "direct"
    WORKAROUND = "workaround"


class Tier(StrEnum):
    """Класс модели по возможностям и цене."""

    FLAGSHIP = "flagship"
    BALANCED = "balanced"
    ECONOMY = "economy"


class Action(StrEnum):
    """Решение политики для пары «категория данных — размещение модели»."""

    ALLOW = "allow"
    MASK = "mask"
    DENY = "deny"


class Quadrant(StrEnum):
    """Квадрант матрицы «эффект — простота внедрения»."""

    QUICK_WIN = "quick_win"
    STRATEGIC = "strategic"
    FILL_IN = "fill_in"
    POSTPONE = "postpone"
    BLOCKED = "blocked"


class Severity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


TASK_LABELS: dict[TaskType, str] = {
    TaskType.CLASSIFICATION: "Классификация и маршрутизация",
    TaskType.EXTRACTION: "Извлечение данных из документов",
    TaskType.SUMMARIZATION: "Резюмирование",
    TaskType.DRAFTING: "Подготовка текстов и ответов",
    TaskType.QA_SEARCH: "Ответы по базе знаний",
    TaskType.TRANSLATION: "Перевод и локализация",
    TaskType.ANALYSIS: "Анализ данных и отчёты",
    TaskType.CODE: "Скрипты, SQL, формулы",
    TaskType.DECISION_SUPPORT: "Поддержка решений",
}

SENSITIVITY_LABELS: dict[Sensitivity, str] = {
    Sensitivity.PUBLIC: "Публичные",
    Sensitivity.INTERNAL: "Внутренние",
    Sensitivity.CONFIDENTIAL: "Конфиденциальные",
    Sensitivity.PERSONAL: "Персональные",
}

DEPLOYMENT_LABELS: dict[Deployment, str] = {
    Deployment.RU_CLOUD: "Российское облако",
    Deployment.FOREIGN_CLOUD: "Зарубежное облако",
    Deployment.SELF_HOSTED: "Свой контур (self-hosted)",
}

RU_ACCESS_LABELS: dict[RuAccess, str] = {
    RuAccess.DIRECT: "Доступна из РФ напрямую",
    RuAccess.WORKAROUND: "Только через обходные пути",
}

TIER_LABELS: dict[Tier, str] = {
    Tier.FLAGSHIP: "Флагман",
    Tier.BALANCED: "Баланс",
    Tier.ECONOMY: "Эконом",
}

ACTION_LABELS: dict[Action, str] = {
    Action.ALLOW: "Можно",
    Action.MASK: "После обезличивания",
    Action.DENY: "Нельзя",
}

QUADRANT_LABELS: dict[Quadrant, str] = {
    Quadrant.QUICK_WIN: "Быстрая победа",
    Quadrant.STRATEGIC: "Стратегический проект",
    Quadrant.FILL_IN: "Попутная задача",
    Quadrant.POSTPONE: "Отложить",
    Quadrant.BLOCKED: "Нет допустимой модели",
}

E = TypeVar("E", bound=StrEnum)


def coerce_enum(enum_cls: type[E], raw: str, labels: Mapping[E, str] | None = None) -> E:
    """Разобрать значение перечисления по коду или русской подписи (без учёта регистра)."""
    text = raw.strip().lower()
    code = text.replace("-", "_").replace(" ", "_")
    for member in enum_cls:
        if code == member.value:
            return member
    for member, label in (labels or {}).items():
        if text == label.lower():
            return member
    allowed = ", ".join(m.value for m in enum_cls)
    raise ValueError(f"неизвестное значение «{raw}», допустимо: {allowed}")


def format_rub(amount: float) -> str:
    """Рубли в русском формате: «1 234 567 ₽»."""
    return f"{round(amount):,}".replace(",", "\u00a0") + "\u00a0₽"
