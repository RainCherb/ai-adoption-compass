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
        except (urllib.error.URLError, ConnectionError, RuntimeError, TimeoutError):
            if time.monotonic() > deadline:
                raise
            time.sleep(1)
    if health["demo_mode"] is not True or health["version"] != version:
        raise RuntimeError("Wrong version or unsafe demo configuration")
    if '<div id="root"' not in request("/"):
        raise RuntimeError("Frontend not packaged")
    profiles = request("/api/models/featured")
    if [m["api_model"] for m in profiles["models"]] != [
        "claude-sonnet-5-5",
        "gpt-6.1-sol",
        "deepseek-flash",
    ]:
        raise RuntimeError("Primary model order or API IDs changed")
    comparison = request("/api/models/compare", {})
    if [row["monthly_usd"] for row in comparison["models"]] != [50, 50, 6.6]:
        raise RuntimeError("Incorrect or stale direct prices")
    off_peak = request("/api/models/compare", {"deepseek_period": "off_peak"})
    if off_peak["models"][2]["monthly_usd"] != 3.3:
        raise RuntimeError("Off-peak price incorrect")
    long_context = request(
        "/api/models/compare",
        {
            "requests_per_month": 1,
            "tokens_in": 272001,
            "tokens_out": 1000,
        },
    )
    if long_context["models"][1]["monthly_usd"] != 1.103004:
        raise RuntimeError("Long context surcharge incorrect")
    request("/api/models/compare", {"tokens_in": 1e308}, expected=422)
    assessment = request("/api/assessments/demo")
    if len(assessment["processes"]) != 18:
        raise RuntimeError("Synthetic assessment not preloaded")
    primary_ids = ["claude-sonnet-5-5", "gpt-6-1-sol", "deepseek-v4-1-flash"]
    catalog = request("/api/catalog")
    if [m["id"] for m in catalog["models"]] != primary_ids:
        raise RuntimeError("Public advisor still uses the old catalogue")
    for process in assessment["result"]["processes"]:
        if process["model"]["model_id"] not in primary_ids:
            raise RuntimeError("Process economics still use an old model")
        if [o["model_id"] for o in process["model_options"]] != primary_ids:
            raise RuntimeError("A process is missing primary model alternatives")
        if process["llm_cost_month_rub"] != process["model"]["cost"]["total_rub"]:
            raise RuntimeError("Selected model and process costs diverge")
    report = request("/api/assessments/demo/report.md")
    exported = request("/api/assessments/demo/export.csv")
    if not all(m["api_model"] in report for m in profiles["models"]):
        raise RuntimeError("Report is missing a primary model")
    if "llm_cost_month_usd" not in exported or len(exported.splitlines()) != 19:
        raise RuntimeError("CSV is missing model costs or processes")
    advice = request(
        "/api/advice",
        {
            "task_type": "classification",
            "data_sensitivity": "public",
            "supported_region": True,
            "prefer": "quality",
            "requests_per_month": 10000,
            "tokens_in": 1000,
            "tokens_out": 300,
        },
    )
    if [r["model_id"] for r in advice["recommendations"]] != primary_ids:
        raise RuntimeError("Default public recommendation order incorrect")
    if [r["cost"]["total_usd"] for r in advice["recommendations"]] != [50, 50, 6.6]:
        raise RuntimeError("Advisor prices differ from the source calculator")
    scenarios = []
    for period in ("peak", "off_peak"):
        scenarios.append(
            request(
                "/api/assess",
                {
                    "processes": assessment["processes"],
                    "assumptions": {"model_preference": "cost", "deepseek_period": period},
                },
            )
        )
    if scenarios[1]["summary"]["cost_month_rub"] >= scenarios[0]["summary"]["cost_month_rub"]:
        raise RuntimeError("DeepSeek period is disconnected from portfolio ROI")
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
