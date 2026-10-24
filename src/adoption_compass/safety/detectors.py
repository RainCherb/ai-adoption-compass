"""Детекторы персональных данных и секретов: регулярные выражения + контрольные суммы."""

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field

from ..domain import Sensitivity

Validator = Callable[[str], bool]


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value)


def luhn_valid(number: str) -> bool:
    """Контрольная сумма Луна для номеров банковских карт."""
    digits = _digits(number)
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for index, char in enumerate(reversed(digits)):
        digit = int(char)
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def inn_valid(number: str) -> bool:
    """Контрольные цифры ИНН (10 цифр — юрлицо, 12 — физлицо)."""
    digits = _digits(number)
    if len(digits) == 10:
        weights = (2, 4, 10, 3, 5, 9, 4, 6, 8)
        check = sum(int(d) * w for d, w in zip(digits[:9], weights, strict=True)) % 11 % 10
        return check == int(digits[9])
    if len(digits) == 12:
        w11 = (7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
        w12 = (3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8)
        c11 = sum(int(d) * w for d, w in zip(digits[:10], w11, strict=True)) % 11 % 10
        c12 = sum(int(d) * w for d, w in zip(digits[:11], w12, strict=True)) % 11 % 10
        return c11 == int(digits[10]) and c12 == int(digits[11])
    return False


def snils_valid(number: str) -> bool:
    """Контрольное число СНИЛС."""
    digits = _digits(number)
    if len(digits) != 11:
        return False
    total = sum(int(digits[i]) * (9 - i) for i in range(9))
    if total < 100:
        control = total
    elif total in (100, 101):
        control = 0
    else:
        control = total % 101
        if control == 100:
            control = 0
    return control == int(digits[9:])


def phone_ru_valid(value: str) -> bool:
    digits = _digits(value)
    return len(digits) == 11 and digits[0] in "78" and digits[1] in "3489"


def ipv4_valid(value: str) -> bool:
    parts = value.split(".")
    return len(parts) == 4 and all(p.isdigit() and int(p) <= 255 for p in parts)


def _real_secret_value(value: str) -> bool:
    """Отсеивает заглушки вроде «********», «<password>» и уже обезличенные метки."""
    if re.fullmatch(r"[*•xX.\-_]+", value):
        return False
    return not value.startswith(("[", "<", "{", "$", "%"))


@dataclass(frozen=True, slots=True)
class DetectorSpec:
    kind: str
    label: str
    tag: str
    pattern: re.Pattern[str]
    implied: Sensitivity
    is_secret: bool = False
    group: int = 0
    validator: Validator | None = None
    confidence: str = "high"
    priority: int = 50


@dataclass(frozen=True, slots=True)
class Finding:
    """Найденный фрагмент. Исходное значение хранится только в памяти и не попадает в repr."""

    kind: str
    label: str
    tag: str
    start: int
    end: int
    implied: Sensitivity
    is_secret: bool
    confidence: str
    value: str = field(repr=False)

    @property
    def preview(self) -> str:
        return make_preview(self.value, self.kind)


def make_preview(value: str, kind: str) -> str:
    """Безопасное представление значения: исходник восстановить нельзя."""
    compact = value.strip()
    if kind == "BANK_CARD":
        return "•••• •••• •••• " + _digits(compact)[-4:]
    if kind == "EMAIL":
        local, _, domain = compact.partition("@")
        return f"{local[:1]}•••@{domain[:1]}•••"
    if len(compact) <= 4:
        return "•" * len(compact)
    return compact[:2] + "•" * min(len(compact) - 4, 8) + compact[-2:]


_PATRONYMIC = r"[А-ЯЁ][а-яё]+(?:(?:ович|евич|ьич|ич)(?:а|у|ем|е)?|(?:овн|евн|ичн)(?:а|ы|е|у|ой|ою))"
_SURNAME = (
    r"[А-ЯЁ][а-яё]*(?:ов|ев|ёв|ин|ын|ск|цк|ых|их|ко|ук|юк|як|ян|дзе|ич|ой|ий|ый|ая)[а-яё]{0,3}"
)
_STREET = (
    r"(?:ул\.|улица|пр-т|пр-кт|проспект|пер\.|переулок|ш\.|шоссе|наб\.|набережная|"
    r"б-р|бульвар|пл\.|площадь)"
)


def _spec(
    kind: str,
    label: str,
    tag: str,
    pattern: str,
    implied: Sensitivity,
    *,
    flags: int = 0,
    **options: object,
) -> DetectorSpec:
    return DetectorSpec(
        kind=kind,
        label=label,
        tag=tag,
        pattern=re.compile(pattern, flags),
        implied=implied,
        **options,  # type: ignore[arg-type]
    )


P, C, I = Sensitivity.PERSONAL, Sensitivity.CONFIDENTIAL, Sensitivity.INTERNAL  # noqa: E741

DEFAULT_DETECTORS: tuple[DetectorSpec, ...] = (
    # --- секреты: самый высокий приоритет ---
    _spec(
        "PRIVATE_KEY",
        "Закрытый ключ",
        "SECRET",
        r"-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----(?:[\s\S]*?-----END (?:[A-Z]+ )*PRIVATE KEY-----)?",
        C,
        is_secret=True,
        priority=10,
    ),
    _spec(
        "URL_CREDENTIALS",
        "Ссылка с логином и паролем",
        "SECRET",
        r"\b[a-z][a-z0-9+.\-]{1,20}://[^\s/:@]+:[^\s/@]+@[^\s/]+",
        C,
        flags=re.IGNORECASE,
        is_secret=True,
        priority=11,
    ),
    _spec(
        "API_KEY",
        "Ключ API",
        "SECRET",
        r"(?<![A-Za-z0-9])sk-[A-Za-z0-9_\-]{20,}",
        C,
        is_secret=True,
        priority=12,
    ),
    _spec(
        "GITHUB_TOKEN",
        "Токен GitHub",
        "SECRET",
        r"(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})",
        C,
        is_secret=True,
        priority=12,
    ),
    _spec(
        "AWS_KEY",
        "Ключ доступа AWS",
        "SECRET",
        r"(?<![A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Z0-9])",
        C,
        is_secret=True,
        priority=12,
    ),
    _spec(
        "GOOGLE_KEY",
        "Ключ Google API",
        "SECRET",
        r"(?<![A-Za-z0-9_\-])AIza[0-9A-Za-z_\-]{35}(?![A-Za-z0-9_\-])",
        C,
        is_secret=True,
        priority=12,
    ),
    _spec(
        "SLACK_TOKEN",
        "Токен Slack",
        "SECRET",
        r"(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}",
        C,
        is_secret=True,
        priority=12,
    ),
    _spec(
        "JWT",
        "JWT-токен",
        "SECRET",
        r"(?<![A-Za-z0-9_\-])eyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}",
        C,
        is_secret=True,
        priority=12,
    ),
    _spec(
        "PASSWORD",
        "Пароль или секрет в явном виде",
        "SECRET",
        r"\b(?:api[_-]?key|secret|token|passw(?:or)?d|pwd|пароль|токен|секрет)\b"
        r"\s*[:=]\s*[\"']?([^\s\"',;]{6,})",
        C,
        flags=re.IGNORECASE,
        is_secret=True,
        group=1,
        validator=_real_secret_value,
        priority=13,
    ),
    # --- персональные и финансовые данные ---
    _spec(
        "BANK_CARD",
        "Номер банковской карты",
        "CARD",
        r"(?<![\d-])(?:\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{4}|\d{4}[ -]\d{6}[ -]\d{5}|\d{16})(?![\d-])",
        P,
        validator=lambda value: luhn_valid(value) and _digits(value)[0] in "23456",
        priority=20,
    ),
    _spec(
        "SNILS",
        "СНИЛС",
        "SNILS",
        r"(?<!\d)\d{3}-\d{3}-\d{3}[ -]\d{2}(?!\d)",
        P,
        validator=snils_valid,
        priority=25,
    ),
    _spec(
        "SNILS",
        "СНИЛС",
        "SNILS",
        r"снилс[^\d\n]{0,15}?(\d{11})(?!\d)",
        P,
        flags=re.IGNORECASE,
        group=1,
        validator=snils_valid,
        priority=25,
    ),
    _spec(
        "INN",
        "ИНН",
        "INN",
        r"\bинн\b[^\d\n]{0,15}?(\d{12}|\d{10})(?!\d)",
        P,
        flags=re.IGNORECASE,
        group=1,
        validator=inn_valid,
        priority=26,
    ),
    _spec(
        "PASSPORT_RU",
        "Паспорт РФ",
        "PASSPORT",
        r"паспорт\w*[^\d\n]{0,25}?(\d{2}\s?\d{2}[\s№N#-]{0,3}\d{6})(?!\d)",
        P,
        flags=re.IGNORECASE,
        group=1,
        priority=27,
    ),
    _spec(
        "PASSPORT_RU",
        "Паспорт РФ",
        "PASSPORT",
        r"сери[яи]\s*\d{2}\s?\d{2}[\s,;]*(?:№|номер|N)?\s*\d{6}(?!\d)",
        P,
        flags=re.IGNORECASE,
        priority=27,
    ),
    _spec(
        "BANK_ACCOUNT",
        "Банковский счёт",
        "ACCOUNT",
        r"(?:р/с|р\.с\.|расч[её]тн\w*\s+сч[её]т|сч[её]т)[^\d\n]{0,15}?(\d{20})(?!\d)",
        C,
        flags=re.IGNORECASE,
        group=1,
        priority=28,
    ),
    _spec(
        "EMAIL",
        "E-mail",
        "EMAIL",
        r"(?<![\w.+-])[\w.+-]+@(?:[\w-]+\.)+[A-Za-zА-Яа-яЁё]{2,}(?![\w@-])",
        P,
        priority=30,
    ),
    _spec(
        "PHONE_RU",
        "Телефон",
        "PHONE",
        r"(?<![\w+])(?:\+7|8|7)[\s\-.]*\(?\d{3}\)?[\s\-.]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}(?!\d)",
        P,
        validator=phone_ru_valid,
        priority=35,
    ),
    _spec(
        "BIRTH_DATE",
        "Дата рождения",
        "BIRTHDATE",
        r"(?:дат[аы]\s+рождения|д\.\s?р\.|родил(?:ся|ась)|рожд\.)[^\d\n]{0,12}?"
        r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})",
        P,
        flags=re.IGNORECASE,
        group=1,
        priority=40,
    ),
    _spec(
        "ADDRESS_RU",
        "Адрес",
        "ADDRESS",
        rf"\b{_STREET}\s*[А-ЯЁA-Z][\w\-. ]{{1,40}}?,?\s*(?:д\.|дом)\s*\d+[а-яa-z]?"
        r"(?:\s*(?:к\.|корп\.|стр\.)\s*\d+)?(?:,?\s*(?:кв\.|квартира|оф\.|офис)\s*\d+)?",
        P,
        flags=re.IGNORECASE,
        confidence="medium",
        priority=45,
    ),
    _spec(
        "PERSON_RU",
        "ФИО",
        "PERSON",
        rf"(?<![А-Яа-яЁё])(?:{_SURNAME}\s+)?[А-ЯЁ][а-яё]+\s+{_PATRONYMIC}(?![а-яё])",
        P,
        confidence="medium",
        priority=50,
    ),
    _spec(
        "IP_ADDRESS",
        "IP-адрес",
        "IP",
        r"(?<!\d)(?<!\d\.)(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)",
        I,
        validator=ipv4_valid,
        confidence="medium",
        priority=60,
    ),
)


def find_findings(
    text: str, detectors: Sequence[DetectorSpec] = DEFAULT_DETECTORS
) -> list[Finding]:
    """Найти все фрагменты; пересечения разрешаются в пользу более приоритетного детектора."""
    candidates: list[tuple[int, Finding]] = []
    for spec in detectors:
        for match in spec.pattern.finditer(text):
            start, end = match.span(spec.group)
            if start < 0:
                continue
            value = text[start:end]
            if spec.validator is not None and not spec.validator(value):
                continue
            candidates.append(
                (
                    spec.priority,
                    Finding(
                        kind=spec.kind,
                        label=spec.label,
                        tag=spec.tag,
                        start=start,
                        end=end,
                        implied=spec.implied,
                        is_secret=spec.is_secret,
                        confidence=spec.confidence,
                        value=value,
                    ),
                )
            )
    candidates.sort(key=lambda item: (item[0], -(item[1].end - item[1].start), item[1].start))
    accepted: list[Finding] = []
    for _, finding in candidates:
        if all(finding.end <= kept.start or finding.start >= kept.end for kept in accepted):
            accepted.append(finding)
    return sorted(accepted, key=lambda f: f.start)
