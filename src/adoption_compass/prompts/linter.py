"""Линтер запросов: оценивает структуру промпта и проверяет, нет ли в нём чувствительных данных."""

import re
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import BaseModel

from ..safety import SafetyGuard

Test = Callable[[str, int], bool]

_RU_VERBS = [
    "сделай",
    "составь",
    "напиши",
    "проанализируй",
    "классифицируй",
    "извлеки",
    "суммируй",
    "резюмируй",
    "перепиши",
    "переведи",
    "подготовь",
    "сформируй",
    "определи",
    "найди",
    "ответь",
    "опиши",
    "сравни",
    "предложи",
    "объясни",
    "проверь",
    "выдели",
    "оцени",
    "придумай",
    "расскажи",
    "перечисли",
    "создай",
    "разработай",
    "исправь",
    "отредактируй",
]
_EN_VERBS = [
    "summarize",
    "summarise",
    "write",
    "classify",
    "extract",
    "translate",
    "analyze",
    "analyse",
    "draft",
    "create",
    "list",
    "compare",
    "explain",
    "review",
    "rewrite",
    "generate",
]

_DELIMITERS = re.compile(r'"""|```|<[A-Za-zА-Яа-яЁё_][\w-]*>|###|---|===|\[\[')


def _rx(pattern: str) -> Test:
    compiled = re.compile(pattern, re.IGNORECASE)
    return lambda text, _words: compiled.search(text) is not None


def _context(text: str, words: int) -> bool:
    keywords = _rx(
        r"контекст|исходн\w+ данн|входн\w+ данн|данные\s*:|материал\w*|\bниже\b|приведен\w+|"
        r"прилагаю|\bcontext\b|\binput\b|\bbackground\b|\bbelow\b|\battached\b"
    )
    return keywords(text, words) or _DELIMITERS.search(text) is not None


@dataclass(frozen=True)
class Rule:
    id: str
    label: str
    weight: int
    hint: str
    test: Test


RULES: tuple[Rule, ...] = (
    Rule(
        "role",
        "Задана роль",
        10,
        "Начните с роли: «Ты — опытный …». Роль задаёт стиль и глубину ответа.",
        _rx(
            r"\b(?:ты|вы)\b\s*(?:—|–|-|:)\s*\w+|\bты\s+(?:являешься|эксперт|опытн\w+|помощник|ассистент)|"
            r"\bроль\s*[:—-]|\byou are\b|\bact as\b|\bas an? (?:expert|assistant|analyst|editor)\b"
        ),
    ),
    Rule(
        "task",
        "Чётко поставлена задача",
        20,
        "Сформулируйте задачу одним предложением с глаголом: «Составь …», «Классифицируй …».",
        _rx(
            r"\b(?:задач[аиу]|цель|task|goal)\b|\b(?:"
            + "|".join(_RU_VERBS)
            + r")(?:те)?\b|\b(?:"
            + "|".join(_EN_VERBS)
            + r")\b"
        ),
    ),
    Rule(
        "context",
        "Есть контекст и исходные данные",
        15,
        "Добавьте контекст: для кого результат, какие данные использовать. Данные отделяйте тегами.",
        _context,
    ),
    Rule(
        "format",
        "Указан формат ответа",
        15,
        "Опишите формат: таблица, JSON, маркированный список, лимит слов («не более 150 слов»).",
        _rx(
            r"формат|в виде|в формате|\bjson\b|\bcsv\b|markdown|таблиц\w*|маркированн\w*|"
            r"нумерованн\w*|список|структур\w*|\bformat\b|\bbullet|\btable\b|не более \d+|"
            r"до \d+ (?:слов|предложен|символ|пункт)|\d+ (?:слов|предложен|абзац|пункт)"
        ),
    ),
    Rule(
        "constraints",
        "Заданы ограничения",
        10,
        "Добавьте ограничения: чего не делать («не выдумывай факты», «только по тексту ниже»).",
        _rx(
            r"\bне (?:используй|придумывай|выдумывай|добавляй|указывай|раскрывай|пиши|делай|допускай)|"
            r"нельзя|запрещ\w+|\bтолько\b|ограничь|ограничен\w+|избегай|\bбез\b|не более|"
            r"\bmust\b|\bdo not\b|\bdon't\b|\bnever\b|\bonly\b|\bavoid\b|\blimit\b|at most|no more than"
        ),
    ),
    Rule(
        "examples",
        "Приведён пример",
        8,
        "Покажите образец ответа: один-два примера резко повышают точность формата.",
        _rx(
            r"пример|образец|например|\bexample\b|e\.g\.|few-shot|вход\s*:|выход\s*:|input\s*:|output\s*:|→|->"
        ),
    ),
    Rule(
        "verification",
        "Есть правило при нехватке данных и проверка",
        12,
        "Добавьте: «Если данных недостаточно, скажи об этом», «Укажи источники и допущения».",
        _rx(
            r"если (?:ты )?(?:не уверен|нет данных|данных (?:недостаточно|нет)|информации (?:недостаточно|нет)|"
            r"не знаешь|ответа нет|не хватает)|не уверен|не выдумывай|не придумывай|"
            r"укажи (?:источник|допущени|степень уверенност)|ссылайся|процитируй|цитат\w+|источник\w*|"
            r"допущени\w+|уверенност\w+|if (?:you are )?(?:unsure|not sure|unknown|no data)|"
            r"\bcite\b|\bsources?\b|\bassumptions?\b|\bconfidence\b"
        ),
    ),
    Rule(
        "delimiters",
        "Данные отделены от инструкций",
        5,
        "Оберните вставляемый текст в теги (<text>…</text>) или тройные кавычки — это защищает от «инъекций».",
        lambda text, _words: _DELIMITERS.search(text) is not None,
    ),
    Rule(
        "length",
        "Разумная длина",
        5,
        "Запрос слишком короткий или слишком длинный: ориентир — от 12 до 1500 слов.",
        lambda _text, words: 12 <= words <= 1500,
    ),
)


class LintCheck(BaseModel):
    id: str
    label: str
    passed: bool
    weight: int
    hint: str | None


class LintResult(BaseModel):
    score: int
    grade: str
    words: int
    checks: list[LintCheck]
    suggestions: list[str]
    sensitive: dict[str, int]
    capped: bool


def _grade(score: int) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 50:
        return "C"
    return "D"


class PromptLinter:
    def __init__(self, guard: SafetyGuard) -> None:
        self.guard = guard

    def lint(self, text: str) -> LintResult:
        words = len(re.findall(r"\w+", text))
        checks: list[LintCheck] = []
        score = 0
        for rule in RULES:
            passed = rule.test(text, words)
            score += rule.weight if passed else 0
            checks.append(
                LintCheck(
                    id=rule.id,
                    label=rule.label,
                    passed=passed,
                    weight=rule.weight,
                    hint=None if passed else rule.hint,
                )
            )
        suggestions = [c.hint for c in checks if c.hint]

        findings = self.guard.scan(text)
        sensitive: dict[str, int] = {}
        for finding in findings:
            sensitive[finding.kind] = sensitive.get(finding.kind, 0) + 1
        capped = False
        if any(f.is_secret for f in findings):
            score, capped = min(score, 30), True
            suggestions.insert(
                0,
                "Критично: в запросе есть секреты (ключи, пароли). Удалите их и перевыпустите ключи.",
            )
        elif findings:
            score, capped = min(score, 69), True
            suggestions.insert(
                0,
                "В запросе есть персональные данные: обезличьте их или используйте допустимую "
                "политикой модель.",
            )
        return LintResult(
            score=score,
            grade=_grade(score),
            words=words,
            checks=checks,
            suggestions=suggestions,
            sensitive=sensitive,
            capped=capped,
        )


def scaffold_prompt(task: str, role: str | None = None) -> str:
    """Каркас хорошего запроса: роль → задача → контекст → формат → ограничения → проверка."""
    task_line = task.strip().rstrip(".") or "опишите задачу одним предложением"
    role_line = role.strip() if role and role.strip() else "опытный специалист по теме задачи"
    return "\n".join(
        [
            f"Ты — {role_line}. Твоя задача — {task_line[:1].lower() + task_line[1:]}.",
            "",
            "Контекст: кратко опишите ситуацию и для кого результат. Исходные данные — ниже.",
            "<data>",
            "…вставьте текст или данные (без персональных данных и секретов)…",
            "</data>",
            "",
            "Формат ответа: укажите структуру (например, таблица или маркированный список) и лимит объёма.",
            "",
            "Ограничения:",
            "- Опирайся только на данные из блока <data>.",
            "- Не выдумывай факты, цифры и источники.",
            "",
            "Пример ответа: приведите один короткий образец нужного результата.",
            "",
            "Если данных недостаточно, скажи об этом и перечисли, чего не хватает. "
            "Укажи допущения, которые ты сделал.",
        ]
    )
