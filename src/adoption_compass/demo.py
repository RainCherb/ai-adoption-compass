"""Публичное демо: синтетическая оценка, без диска и общего журнала посетителей."""

import time
from collections import deque
from threading import Lock
from typing import Any

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .storage import AssessmentSummary, Event, Storage, StoredAssessment


class DemoStorage(Storage):
    """Read-only снимок. Введённые посетителем данные никогда не записываются."""

    def __init__(self, assessment: StoredAssessment) -> None:
        self.assessment = assessment

    def ping(self) -> bool:
        return True

    def list_assessments(self, limit: int = 50) -> list[AssessmentSummary]:
        return [AssessmentSummary.model_validate(self.assessment.model_dump())][:limit]

    def get_assessment(self, assessment_id: str) -> StoredAssessment | None:
        return self.assessment.model_copy(deep=True) if assessment_id == "demo" else None

    def save_assessment(self, name: str, request: dict[str, Any], result: dict[str, Any]) -> str:
        raise RuntimeError("Публичное демо не сохраняет пользовательские данные")

    def delete_assessment(self, assessment_id: str) -> bool:
        return False

    def log_event(self, kind: str, payload: dict[str, Any]) -> None:
        pass

    def list_events(self, limit: int = 100, kind: str | None = None) -> list[Event]:
        return []


class DemoGuard:
    """Предел тела до парсинга JSON/multipart и общий бюджет POST без хранения IP."""

    def __init__(
        self, app: ASGIApp, max_bytes: int = 128_000, requests_per_minute: int = 180
    ) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.requests_per_minute = requests_per_minute
        self.requests: deque[float] = deque()
        self.lock = Lock()

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope["path"].startswith("/api/"):
            await self.app(scope, receive, send)
            return
        path, method = scope["path"], scope["method"]
        if method == "DELETE" or (
            method == "POST" and path.rstrip("/") in {"/api/assessments", "/api/assessments/upload"}
        ):
            await JSONResponse(
                {"detail": "В публичном демо сохранение и загрузка CSV отключены"}, 403
            )(scope, receive, send)
            return
        if path not in {"/api/health", "/api/meta"}:
            now = time.monotonic()
            with self.lock:
                while self.requests and self.requests[0] <= now - 60:
                    self.requests.popleft()
                limited = len(self.requests) >= self.requests_per_minute
                if not limited:
                    self.requests.append(now)
            if limited:
                await JSONResponse(
                    {"detail": "Лимит демо: повторите запрос через минуту"},
                    429,
                    headers={"Retry-After": "60"},
                )(scope, receive, send)
                return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                await JSONResponse({"detail": "Запрос превышает лимит публичного демо"}, 413)(
                    scope, receive, send
                )
                return
            if not message.get("more_body", False):
                break
        delivered = False

        async def bounded_receive() -> Message:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, bounded_receive, send)
