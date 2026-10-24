import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from adoption_compass.api import create_app
from adoption_compass.config import Settings
from adoption_compass.demo import DemoGuard


def test_demo_has_no_disk_or_cross_visitor_history(settings):
    app = create_app(replace(settings, demo_mode=True))
    with TestClient(app) as first, TestClient(app) as second:
        assert first.get("/api/health").json()["demo_mode"] is True
        assert first.get("/api/meta").json()["demo_mode"] is True
        saved = first.get("/api/assessments").json()
        assert len(saved) == 1
        assert saved[0]["id"] == "demo"
        original = first.get("/api/assessments/demo").json()
        assert len(original["processes"]) == 18
        payload = {"processes": original["processes"], "assumptions": {"usd_rub": 120}}
        assert first.post("/api/assess", json=payload).status_code == 200
        assert (
            first.post("/api/safety/analyze", json={"text": "Вымышленный текст"}).status_code == 200
        )
        assert second.get("/api/audit").json() == {"events": []}
        assert second.get("/api/assessments/demo").json() == original
        assert first.get("/api/assessments/other-user").status_code == 404
        assert first.post("/api/assessments/demo").json()["assessment"] == original
        assert first.get("/api/assessments/demo/report.md").status_code == 200
        assert first.get("/api/assessments/demo/export.csv").status_code == 200
    assert not settings.db_path.exists()


def test_demo_blocks_persistence_before_parsing(settings):
    with TestClient(create_app(replace(settings, demo_mode=True))) as client:
        for path in ("/api/assessments", "/api/assessments/", "/api/assessments/upload"):
            response = client.post(path, content=b"not-json")
            assert response.status_code == 403
            assert response.headers["x-content-type-options"] == "nosniff"
        assert client.delete("/api/assessments/demo").status_code == 403
        response = client.post("/api/safety/analyze", content=b"x" * 128_001)
        assert response.status_code == 413
        processes = client.get("/api/assessments/demo").json()["processes"]
        assert client.post("/api/assess", json={"processes": processes * 3}).status_code == 422


def test_rate_limit_is_bounded_and_leaves_health_available():
    async def handler(request):
        return JSONResponse({"ok": True})

    app = DemoGuard(
        Starlette(
            routes=[
                Route("/api/test", handler, methods=["GET", "POST"]),
                Route("/api/health", handler),
            ]
        ),
        requests_per_minute=1,
    )
    with TestClient(app) as client:
        assert client.post("/api/test").status_code == 200
        limited = client.post("/api/test")
        assert limited.status_code == 429
        assert limited.headers["retry-after"] == "60"
        assert client.get("/api/test").status_code == 429
        assert client.get("/api/health").status_code == 200


def test_demo_setting_is_opt_in():
    assert not Settings.from_env({}).demo_mode
    assert Settings.from_env({"COMPASS_DEMO_MODE": "true"}).demo_mode


@pytest.mark.parametrize("number", [1e308, float("inf"), float("nan"), -1])
def test_extreme_numeric_inputs_return_422_without_echoing_private_input(settings, number):
    with TestClient(
        create_app(replace(settings, demo_mode=True)), raise_server_exceptions=False
    ) as client:
        processes = client.get("/api/assessments/demo").json()["processes"]
        payload = {
            "name": "private marker",
            "processes": processes,
            "assumptions": {"implementation_day_rub": number},
        }
        result = client.post(
            "/api/assess", content=json.dumps(payload), headers={"Content-Type": "application/json"}
        )
        assert result.status_code == 422
        assert "private marker" not in result.text
        assert "input" not in result.json()["detail"][0]
