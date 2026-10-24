"""Хранилище на SQLite: сохранённые оценки и журнал событий (без исходных текстов)."""

import json
import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel

MAX_EVENTS = 5000

MIGRATIONS: dict[int, str] = {
    1: """
    CREATE TABLE assessments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        processes_count INTEGER NOT NULL,
        recommended_count INTEGER NOT NULL,
        hours_saved_month REAL NOT NULL,
        net_horizon_rub REAL NOT NULL,
        request_json TEXT NOT NULL,
        result_json TEXT NOT NULL
    );
    CREATE INDEX idx_assessments_created ON assessments(created_at DESC);
    CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL
    );
    CREATE INDEX idx_events_kind ON events(kind, id DESC);
    """,
}


class AssessmentSummary(BaseModel):
    id: str
    name: str
    created_at: str
    processes_count: int
    recommended_count: int
    hours_saved_month: float
    net_horizon_rub: float


class StoredAssessment(AssessmentSummary):
    request: dict[str, Any]
    result: dict[str, Any]


class Event(BaseModel):
    id: int
    ts: str
    kind: str
    payload: dict[str, Any]


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Storage:
    """Каждая операция открывает короткое соединение — безопасно для потоков FastAPI."""

    def __init__(self, path: Path) -> None:
        self.path = path
        if str(path) != ":memory:":
            path.parent.mkdir(parents=True, exist_ok=True)
        self._migrate()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _migrate(self) -> None:
        with self._connect() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            for target in sorted(MIGRATIONS):
                if target > version:
                    conn.executescript(MIGRATIONS[target])
                    conn.execute(f"PRAGMA user_version = {int(target)}")

    def ping(self) -> bool:
        try:
            with self._connect() as conn:
                conn.execute("SELECT 1").fetchone()
        except sqlite3.Error:
            return False
        return True

    # --- оценки ---------------------------------------------------------------------------

    def save_assessment(self, name: str, request: dict[str, Any], result: dict[str, Any]) -> str:
        assessment_id = uuid.uuid4().hex[:12]
        summary = result["summary"]
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO assessments (id, name, created_at, processes_count, recommended_count,"
                " hours_saved_month, net_horizon_rub, request_json, result_json)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    assessment_id,
                    name,
                    _now(),
                    summary["processes_total"],
                    summary["recommended_count"],
                    summary["hours_saved_month"],
                    summary["net_horizon_rub"],
                    json.dumps(request, ensure_ascii=False),
                    json.dumps(result, ensure_ascii=False),
                ),
            )
        return assessment_id

    def get_assessment(self, assessment_id: str) -> StoredAssessment | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM assessments WHERE id = ?", (assessment_id,)
            ).fetchone()
        if row is None:
            return None
        return StoredAssessment(
            id=row["id"],
            name=row["name"],
            created_at=row["created_at"],
            processes_count=row["processes_count"],
            recommended_count=row["recommended_count"],
            hours_saved_month=row["hours_saved_month"],
            net_horizon_rub=row["net_horizon_rub"],
            request=json.loads(row["request_json"]),
            result=json.loads(row["result_json"]),
        )

    def list_assessments(self, limit: int = 50) -> list[AssessmentSummary]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, name, created_at, processes_count, recommended_count,"
                " hours_saved_month, net_horizon_rub FROM assessments"
                " ORDER BY created_at DESC, rowid DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [AssessmentSummary(**dict(row)) for row in rows]

    def delete_assessment(self, assessment_id: str) -> bool:
        with self._connect() as conn:
            cursor = conn.execute("DELETE FROM assessments WHERE id = ?", (assessment_id,))
            return cursor.rowcount > 0

    # --- журнал событий: только метаданные, никогда не исходные тексты ----------------------

    def log_event(self, kind: str, payload: dict[str, Any]) -> None:
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO events (ts, kind, payload_json) VALUES (?, ?, ?)",
                (_now(), kind, json.dumps(payload, ensure_ascii=False)),
            )
            conn.execute(
                "DELETE FROM events WHERE id <= (SELECT MAX(id) FROM events) - ?", (MAX_EVENTS,)
            )

    def list_events(self, limit: int = 100, kind: str | None = None) -> list[Event]:
        query = "SELECT id, ts, kind, payload_json FROM events"
        params: list[Any] = []
        if kind:
            query += " WHERE kind = ?"
            params.append(kind)
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self._connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [
            Event(id=r["id"], ts=r["ts"], kind=r["kind"], payload=json.loads(r["payload_json"]))
            for r in rows
        ]
