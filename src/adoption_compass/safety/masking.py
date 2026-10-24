"""Обезличивание: замена найденных значений метками и обратная подстановка."""

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .detectors import Finding

_PLACEHOLDER = re.compile(r"\[([A-Z]+_\d+)\]")


@dataclass(frozen=True)
class MaskResult:
    text: str
    mapping: dict[str, str]
    counts: dict[str, int]


def mask_text(text: str, findings: Sequence[Finding]) -> MaskResult:
    """Заменить находки метками вида [PHONE_1]. Одинаковые значения получают одну метку.

    Метки, уже присутствующие в исходном тексте, не переиспользуются, поэтому
    unmask_text(mask_text(x)) всегда возвращает x.
    """
    taken = set(_PLACEHOLDER.findall(text))
    counters: dict[str, int] = {}
    issued: dict[tuple[str, str], str] = {}
    mapping: dict[str, str] = {}
    parts: list[str] = []
    cursor = 0
    for finding in sorted(findings, key=lambda f: f.start):
        if finding.start < cursor:
            continue
        parts.append(text[cursor : finding.start])
        key = (finding.tag, finding.value)
        placeholder = issued.get(key)
        if placeholder is None:
            number = counters.get(finding.tag, 0) + 1
            while f"{finding.tag}_{number}" in taken:
                number += 1
            counters[finding.tag] = number
            placeholder = f"[{finding.tag}_{number}]"
            issued[key] = placeholder
            mapping[placeholder] = finding.value
        parts.append(placeholder)
        cursor = finding.end
    parts.append(text[cursor:])
    counts: dict[str, int] = {}
    for tag, _ in issued:
        counts[tag] = counts.get(tag, 0) + 1
    return MaskResult(text="".join(parts), mapping=mapping, counts=counts)


def unmask_text(text: str, mapping: Mapping[str, str]) -> str:
    """Вернуть исходные значения вместо меток (метки, которых нет в mapping, остаются)."""
    return _PLACEHOLDER.sub(lambda m: mapping.get(f"[{m.group(1)}]", m.group(0)), text)
