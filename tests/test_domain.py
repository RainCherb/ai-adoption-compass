import pytest

from adoption_compass.domain import (
    SENSITIVITY_LABELS,
    TASK_LABELS,
    Sensitivity,
    TaskType,
    coerce_enum,
    format_rub,
    max_sensitivity,
)


def test_sensitivity_is_ordered_from_public_to_personal():
    ranks = [
        s.rank
        for s in (
            Sensitivity.PUBLIC,
            Sensitivity.INTERNAL,
            Sensitivity.CONFIDENTIAL,
            Sensitivity.PERSONAL,
        )
    ]
    assert ranks == sorted(ranks) == [0, 1, 2, 3]


def test_max_sensitivity_picks_strictest():
    assert (
        max_sensitivity(Sensitivity.INTERNAL, Sensitivity.PERSONAL, Sensitivity.PUBLIC)
        is Sensitivity.PERSONAL
    )
    assert max_sensitivity(Sensitivity.PUBLIC) is Sensitivity.PUBLIC


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("classification", TaskType.CLASSIFICATION),
        ("  QA-Search ", TaskType.QA_SEARCH),
        ("decision support", TaskType.DECISION_SUPPORT),
        ("Резюмирование", TaskType.SUMMARIZATION),
        ("классификация и маршрутизация", TaskType.CLASSIFICATION),
    ],
)
def test_coerce_enum_accepts_codes_and_russian_labels(raw, expected):
    assert coerce_enum(TaskType, raw, TASK_LABELS) is expected


def test_coerce_enum_rejects_unknown_value_with_hint():
    with pytest.raises(ValueError, match="допустимо"):
        coerce_enum(Sensitivity, "секретно", SENSITIVITY_LABELS)


def test_format_rub_uses_non_breaking_spaces():
    assert format_rub(1234567.4) == "1\u00a0234\u00a0567\u00a0₽"
    assert format_rub(0) == "0\u00a0₽"
