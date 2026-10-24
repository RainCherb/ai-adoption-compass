import sqlite3
from datetime import date

import pytest

from adoption_compass import storage as storage_module
from adoption_compass.advisor import Advisor
from adoption_compass.assessment import AssessmentEngine, Process
from adoption_compass.catalog import load_catalog
from adoption_compass.csv_io import parse_processes_csv
from adoption_compass.reports import CSV_COLUMNS, assessment_csv, assessment_markdown
from adoption_compass.resources import read_data_text
from adoption_compass.safety import Policy
from adoption_compass.scoring import load_scoring
from adoption_compass.storage import Storage


def fake_result(net: float = 1000.0) -> dict:
    return {
        "summary": {
            "processes_total": 3,
            "recommended_count": 2,
            "hours_saved_month": 12.5,
            "net_horizon_rub": net,
        }
    }


class TestStorage:
    def test_assessment_roundtrip_list_and_delete(self, tmp_path):
        db = Storage(tmp_path / "nested" / "dir" / "x.db")
        first = db.save_assessment("Первая", {"processes": []}, fake_result(10))
        second = db.save_assessment("Вторая", {"processes": [1]}, fake_result(20))
        stored = db.get_assessment(second)
        assert stored
        assert stored.name == "Вторая"
        assert stored.request == {"processes": [1]}
        assert stored.net_horizon_rub == 20
        assert stored.recommended_count == 2
        assert [a.id for a in db.list_assessments()] == [second, first]
        assert len(db.list_assessments(limit=1)) == 1
        assert db.delete_assessment(first)
        assert not db.delete_assessment(first)
        assert db.get_assessment(first) is None
        assert db.get_assessment("missing") is None

    def test_events_are_listed_newest_first_and_filterable(self, tmp_path):
        db = Storage(tmp_path / "x.db")
        db.log_event("a", {"n": 1})
        db.log_event("b", {"n": 2})
        db.log_event("a", {"n": 3})
        assert [e.payload["n"] for e in db.list_events()] == [3, 2, 1]
        assert [e.payload["n"] for e in db.list_events(kind="a")] == [3, 1]
        assert len(db.list_events(limit=2)) == 2

    def test_event_log_is_pruned(self, tmp_path, monkeypatch):
        monkeypatch.setattr(storage_module, "MAX_EVENTS", 5)
        db = Storage(tmp_path / "x.db")
        for n in range(12):
            db.log_event("e", {"n": n})
        events = db.list_events(limit=100)
        assert len(events) <= 6
        assert events[0].payload["n"] == 11

    def test_migrations_are_idempotent_and_versioned(self, tmp_path):
        path = tmp_path / "x.db"
        Storage(path).save_assessment("A", {}, fake_result())
        again = Storage(path)  # повторная инициализация не стирает данные
        assert len(again.list_assessments()) == 1
        with sqlite3.connect(path) as conn:
            assert conn.execute("PRAGMA user_version").fetchone()[0] == max(
                storage_module.MIGRATIONS
            )
            assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "wal"

    def test_ping(self, tmp_path):
        assert Storage(tmp_path / "x.db").ping()

    def test_failed_write_is_rolled_back(self, tmp_path):
        db = Storage(tmp_path / "x.db")
        with pytest.raises(KeyError):
            db.save_assessment("bad", {}, {"no": "summary"})
        assert db.list_assessments() == []


@pytest.fixture(scope="module")
def engine():
    return AssessmentEngine(
        load_scoring(), Advisor(load_catalog(), Policy.load(), today=date(2026, 10, 24))
    )


@pytest.fixture(scope="module")
def demo(engine):
    return engine.assess(parse_processes_csv(read_data_text("samples/processes.csv")).processes)


class TestReports:
    def test_markdown_has_all_sections_and_the_key_numbers(self, demo):
        text = assessment_markdown(demo, generated=date(2026, 10, 24))
        for heading in (
            "# Оценка процессов для внедрения ИИ",
            "## Главное",
            "## Дорожная карта",
            "## Рейтинг всех процессов",
            "## Отложено и заблокировано",
            "## Инфраструктура self-hosted",
            "## Риски и условия внедрения",
            "## Допущения расчёта",
        ):
            assert heading in text, heading
        assert "24.10.2026" in text
        assert "Волна 1" in text
        assert "ч/мес" in text
        assert "ROI за 12 мес." in text
        assert "демонстрационные цены" in text

    def test_every_recommended_process_is_in_the_roadmap_tables(self, demo):
        text = assessment_markdown(demo)
        for p in demo.processes:
            if p.wave is not None:
                assert p.name in text

    def test_blocked_processes_are_explained(self, demo):
        text = assessment_markdown(demo)
        blocked = [p for p in demo.processes if p.quadrant.value == "blocked"]
        assert blocked
        section = text.split("## Отложено и заблокировано")[1]
        assert all(p.name in section for p in blocked)
        assert "Нет модели" in section

    def test_pipes_in_names_do_not_break_tables(self, engine):
        result = engine.assess(
            [
                Process(
                    id="X",
                    name="A | B",
                    task_type="drafting",
                    runs_per_month=5000,
                    minutes_per_run=10,
                )
            ]
        )
        assert "A \\| B" in assessment_markdown(result)

    def test_empty_roadmap_has_explanatory_text(self, engine):
        result = engine.assess(
            [
                Process(
                    id="X", name="Мелочь", task_type="drafting", runs_per_month=1, minutes_per_run=1
                )
            ]
        )
        assert "Нет процессов, которые стоит внедрять" in assessment_markdown(result)

    def test_csv_is_excel_friendly(self, demo):
        text = assessment_csv(demo)
        assert text.startswith("\ufeff")
        assert text.splitlines()[0].lstrip("\ufeff") == ";".join(CSV_COLUMNS)
        assert len(text.strip().splitlines()) == len(demo.processes) + 1
        blocked_row = next(line for line in text.splitlines() if ";blocked;" in line).split(";")
        assert blocked_row[CSV_COLUMNS.index("payback_months")] == ""
