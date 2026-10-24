"""Метрики классификации без внешних зависимостей."""

import math
from collections.abc import Sequence

from pydantic import BaseModel


class ClassStats(BaseModel):
    label: str
    precision: float
    recall: float
    f1: float
    support: int


class Metrics(BaseModel):
    n: int
    accuracy: float
    macro_f1: float
    invalid: int
    labels: list[str]
    per_class: list[ClassStats]
    confusion: list[list[int]]


def percentile(values: Sequence[float], q: float) -> float:
    """Перцентиль методом ближайшего ранга (q в диапазоне 0–100)."""
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil(q / 100 * len(ordered)))
    return ordered[rank - 1]


def _ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0


def compute_metrics(
    labels: Sequence[str], expected: Sequence[str], predicted: Sequence[str | None]
) -> Metrics:
    """Точность, F1 по классам и матрица ошибок (строки — истина, столбцы — предсказание).

    Невалидный ответ (None) считается ошибкой и снижает полноту истинного класса.
    """
    if len(expected) != len(predicted):
        raise ValueError("expected и predicted должны быть одной длины")
    index = {label: i for i, label in enumerate(labels)}
    size = len(labels)
    confusion = [[0] * size for _ in range(size)]
    invalid = 0
    for truth, guess in zip(expected, predicted, strict=True):
        if guess is None or guess not in index:
            invalid += 1
            continue
        confusion[index[truth]][index[guess]] += 1

    stats: list[ClassStats] = []
    for label, i in index.items():
        true_positive = confusion[i][i]
        predicted_total = sum(confusion[row][i] for row in range(size))
        support = sum(1 for truth in expected if truth == label)
        precision = _ratio(true_positive, predicted_total)
        recall = _ratio(true_positive, support)
        f1 = _ratio(2 * precision * recall, precision + recall)
        stats.append(
            ClassStats(
                label=label,
                precision=round(precision, 4),
                recall=round(recall, 4),
                f1=round(f1, 4),
                support=support,
            )
        )
    correct = sum(confusion[i][i] for i in range(size))
    present = [s.f1 for s in stats if s.support > 0]
    return Metrics(
        n=len(expected),
        accuracy=round(_ratio(correct, len(expected)), 4),
        macro_f1=round(_ratio(sum(present), len(present)), 4),
        invalid=invalid,
        labels=list(labels),
        per_class=stats,
        confusion=confusion,
    )
