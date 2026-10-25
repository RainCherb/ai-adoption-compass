import pytest

from adoption_compass.csv_io import (
    MAX_ROWS,
    CsvFormatError,
    decode_csv_bytes,
    parse_processes_csv,
)
from adoption_compass.domain import Sensitivity, TaskType
from adoption_compass.resources import read_data_text

HEADER = "name,task_type,runs_per_month,minutes_per_run"


def test_bundled_sample_parses_without_errors():
    parsed = parse_processes_csv(read_data_text("samples/processes.csv"))
    assert len(parsed.processes) == 18
    assert parsed.errors == []
    assert parsed.delimiter == ","
    assert parsed.processes[0].id == "P01"
    # Свой контур продукт не предлагает: образец целиком считается на облачных API.
    assert not any(p.must_self_host for p in parsed.processes)
    assert parsed.processes[0].data_sensitivity.value == "personal"


def test_minimal_file_gets_generated_ids_and_defaults():
    parsed = parse_processes_csv(f"{HEADER}\nОтветы,drafting,100,5\nПеревод,translation,50,10\n")
    assert [p.id for p in parsed.processes] == ["P01", "P02"]
    assert parsed.processes[0].data_sensitivity is Sensitivity.INTERNAL
    assert parsed.processes[0].standardization == 3


def test_excel_style_semicolon_file_with_russian_headers_and_labels():
    content = (
        "Название;Тип задачи;Запусков в месяц;Минут на запуск;Доля ошибок;Категория данных;Только self-hosted\n"
        "Ответы клиентам;Подготовка текстов и ответов;1 200;2,5;8%;Персональные;да\n"
    )
    parsed = parse_processes_csv(content)
    assert parsed.errors == []
    assert parsed.delimiter == ";"
    p = parsed.processes[0]
    assert (p.task_type, p.runs_per_month, p.minutes_per_run) == (TaskType.DRAFTING, 1200, 2.5)
    assert p.error_rate == pytest.approx(0.08)
    assert p.data_sensitivity is Sensitivity.PERSONAL
    assert p.must_self_host is True


def test_percent_values_without_sign_are_treated_as_percent():
    parsed = parse_processes_csv(f"{HEADER},error_rate\nA,drafting,10,1,12\n")
    assert parsed.processes[0].error_rate == pytest.approx(0.12)


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "cp1251"])
def test_decodes_common_encodings(encoding):
    raw = f"{HEADER}\nОтветы клиентам,drafting,100,5\n".encode(encoding)
    parsed = parse_processes_csv(raw)
    assert parsed.processes[0].name == "Ответы клиентам"


def test_decode_prefers_utf8_and_falls_back_to_cp1251():
    assert decode_csv_bytes("привет".encode()) == "привет"
    assert decode_csv_bytes("привет".encode("cp1251")) == "привет"


def test_bad_rows_are_reported_with_line_numbers_but_do_not_stop_parsing():
    content = (
        f"{HEADER}\n"
        "Хороший,drafting,100,5\n"
        "Плохой тип,magic,100,5\n"
        "Отрицательный объём,drafting,-5,5\n"
        "Не число,drafting,много,5\n"
    )
    parsed = parse_processes_csv(content)
    assert [p.name for p in parsed.processes] == ["Хороший"]
    assert [e.line for e in parsed.errors] == [3, 4, 5]
    assert "task_type" in parsed.errors[0].message
    assert "runs_per_month" in parsed.errors[1].message


def test_blank_lines_are_skipped():
    parsed = parse_processes_csv(f"{HEADER}\n\nА,drafting,10,1\n,,,\n")
    assert len(parsed.processes) == 1
    assert parsed.errors == []


@pytest.mark.parametrize(
    ("content", "message"),
    [("", "пустой"), ("   \n", "пустой"), ("name,task_type\nA,drafting\n", "runs_per_month")],
)
def test_unparseable_files_raise_format_error(content, message):
    with pytest.raises(CsvFormatError, match=message):
        parse_processes_csv(content)


def test_row_limit_protects_against_huge_uploads():
    rows = "\n".join("A,drafting,10,1" for _ in range(MAX_ROWS + 1))
    with pytest.raises(CsvFormatError, match="Слишком много строк"):
        parse_processes_csv(f"{HEADER}\n{rows}\n")


def test_unknown_columns_are_ignored():
    parsed = parse_processes_csv(f"{HEADER},комментарий\nA,drafting,10,1,что угодно\n")
    assert len(parsed.processes) == 1
    assert parsed.errors == []
