"""Проверка настоящего HTTP-демо без зависимостей, установки моделей и платных запросов."""

import argparse
import json
import time
import tomllib
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    version = tomllib.loads(
        (Path(__file__).resolve().parent.parent / "pyproject.toml").read_text(encoding="utf-8")
    )["project"]["version"]
    checks: list[str] = []

    def request(
        path: str,
        body: dict[str, Any] | None = None,
        *,
        expected: int = 200,
        method: str | None = None,
    ) -> Any:
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = {"Content-Type": "application/json"} if data else {}
        req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
        try:
            response = urllib.request.urlopen(req, timeout=30)
        except urllib.error.HTTPError as exc:
            response = exc
        with response:
            if response.status != expected:
                raise RuntimeError(f"{path}: HTTP {response.status}, expected {expected}")
            text = response.read().decode("utf-8")
            if path.startswith("/api/"):
                if response.headers.get("X-Content-Type-Options") != "nosniff":
                    raise RuntimeError("Missing security headers")
                if response.headers.get("Cache-Control") != "no-store":
                    raise RuntimeError("API responses must not be cached")
            checks.append(f"{method or ('POST' if data else 'GET')} {path}: {expected}")
            return (
                json.loads(text)
                if "application/json" in response.headers.get("Content-Type", "")
                else text
            )

    deadline = time.monotonic() + 120
    while True:
        try:
            health = request("/api/health")
            break
        except (urllib.error.URLError, RuntimeError, TimeoutError):
            if time.monotonic() > deadline:
                raise
            time.sleep(1)
    if health["demo_mode"] is not True or health["version"] != version:
        raise RuntimeError("Wrong version or unsafe demo configuration")
    if '<div id="root"' not in request("/"):
        raise RuntimeError("Frontend not packaged")
    assessment = request("/api/assessments/demo")
    if len(assessment["processes"]) != 18:
        raise RuntimeError("Synthetic assessment not preloaded")
    recalculated = request(
        "/api/assess", {"processes": assessment["processes"], "assumptions": {"horizon_months": 24}}
    )
    if recalculated["assumptions"]["horizon_months"] != 24:
        raise RuntimeError("What-if calculation failed")
    request(
        "/api/advice",
        {
            "task_type": "classification",
            "requests_per_month": 1000,
            "tokens_in": 100,
            "tokens_out": 20,
        },
    )
    request(
        "/api/safety/analyze",
        {"text": "Синтетический пример: user@example.invalid", "declared_sensitivity": "public"},
    )
    request(
        "/api/prompts/lint",
        {"text": "Ты редактор. Составь список из трёх пунктов без персональных данных."},
    )
    if request("/api/evals/measured")["kind"] != "measured":
        raise RuntimeError("Missing real measurements")
    if request("/api/evals/demo")["kind"] != "simulated":
        raise RuntimeError("Simulation is not labelled")
    if not request("/api/catalog/sources")["sources"]:
        raise RuntimeError("Missing source registry")
    request("/api/assessments", {}, expected=403)
    request("/api/assessments/upload", {}, expected=403)
    request("/api/assessments/demo", expected=403, method="DELETE")
    request(
        "/api/assess",
        {"processes": assessment["processes"], "assumptions": {"implementation_day_rub": 1e308}},
        expected=422,
    )
    if request("/api/audit")["events"] or len(request("/api/assessments")) != 1:
        raise RuntimeError("Visitor data persisted")
    print(
        json.dumps(
            {"url": base, "version": version, "checks": checks, "result": "passed"},
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
