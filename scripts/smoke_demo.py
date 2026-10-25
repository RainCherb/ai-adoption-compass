"""Проверка настоящего HTTP-демо без зависимостей, установки моделей и платных запросов."""

import argparse
import json
import math
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
    russian = {
        "yandexgpt-pro-5-1",
        "alice-ai-llm",
        "gigachat-2-max",
        "gigachat-2-pro",
        "gigachat-2-lite",
    }
    foreign = {
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "gpt-6-1-sol",
        "gpt-6-luna",
        "deepseek-v4-1-flash",
        "deepseek-v4-pro",
    }
    expected_ids = russian | foreign
    profiles = request("/api/models/featured")
    by_id = {m["id"]: m for m in profiles["models"]}
    if set(by_id) != expected_ids:
        raise RuntimeError("Verified model inventory differs from the release")
    for model_id, model in by_id.items():
        expected_status = (
            "available"
            if model_id in russian
            else "unverified"
            if model_id.startswith("deepseek")
            else "unavailable"
        )
        if model["russia_api_status"] != expected_status or model["currency"] != (
            "RUB" if model_id in russian else "USD"
        ):
            raise RuntimeError("Incorrect regional availability or native currency")
    meta = request("/api/meta")
    if any(d["value"] == "self_hosted" for d in meta["deployments"]):
        raise RuntimeError("Local deployment is still exposed")
    policy = request("/api/safety/policy")
    if any("self_hosted" in row for row in policy["matrix"].values()):
        raise RuntimeError("Local deployment is still in API policy")
    comparison = request("/api/models/compare", {})
    prices = {r["model"]["id"]: r for r in comparison["models"]}
    expected_rub = {
        "yandexgpt-pro-5-1": 10400,
        "alice-ai-llm": 8600,
        "gigachat-2-max": 8450,
        "gigachat-2-pro": 6500,
        "gigachat-2-lite": 845,
    }
    expected_usd = {
        "claude-sonnet-5-5": 50,
        "claude-haiku-5-5": 2.5,
        "gpt-6-1-sol": 50,
        "gpt-6-luna": 2.5,
        "deepseek-v4-1-flash": 6.6,
        "deepseek-v4-pro": 25.08,
    }
    if set(prices) != expected_ids or comparison["usd_rub"] != 80.54:
        raise RuntimeError("Incomplete prices or inconsistent exchange rate")
    for model_id, expected_price in (expected_rub | expected_usd).items():
        column = "monthly_rub" if model_id in russian else "monthly_usd"
        if not math.isclose(prices[model_id][column], expected_price, abs_tol=1e-9):
            raise RuntimeError(f"Incorrect direct quote for {model_id}")
    off_peak = request("/api/models/compare", {"deepseek_period": "off_peak"})
    for row in off_peak["models"]:
        expected = prices[row["model"]["id"]]["monthly_usd"]
        if row["model"]["id"].startswith("deepseek"):
            expected /= 2
        if not math.isclose(row["monthly_usd"], expected, abs_tol=1e-9):
            raise RuntimeError("Off-peak price incorrect")
    long_context = request(
        "/api/models/compare", {"requests_per_month": 1, "tokens_in": 272001, "tokens_out": 1000}
    )
    long_prices = {r["model"]["id"]: r for r in long_context["models"]}
    if not math.isclose(long_prices["gpt-6-1-sol"]["monthly_usd"], 1.103004):
        raise RuntimeError("Long context surcharge incorrect")
    if long_prices["yandexgpt-pro-5-1"]["available"]:
        raise RuntimeError("Context limit was ignored")
    haiku = request(
        "/api/models/compare", {"requests_per_month": 1, "tokens_in": 100001, "tokens_out": 1000}
    )
    haiku_line = next(r for r in haiku["models"] if r["model"]["id"] == "claude-haiku-5-5")
    if not math.isclose(haiku_line["monthly_usd"], 0.0525005):
        raise RuntimeError("Haiku long context surcharge incorrect")
    request("/api/models/compare", {"tokens_in": 1e308}, expected=422)
    assessment = request("/api/assessments/demo")
    if len(assessment["processes"]) != 18:
        raise RuntimeError("Synthetic assessment not preloaded")
    primary_ids = expected_ids
    catalog = request("/api/catalog")
    if {m["id"] for m in catalog["models"]} != primary_ids:
        raise RuntimeError("Public advisor still uses the old catalogue")
    for process in assessment["result"]["processes"]:
        if process["model"] is None:
            continue
        if process["model"]["model_id"] not in russian:
            raise RuntimeError("Default portfolio assumes unavailable foreign access")
        if {o["model_id"] for o in process["model_options"]} != primary_ids:
            raise RuntimeError("A process is missing primary model alternatives")
        if process["llm_cost_month_rub"] != process["model"]["cost"]["total_rub"]:
            raise RuntimeError("Selected model and process costs diverge")
    summary = assessment["result"]["summary"]
    if summary["processes_blocked"] != 3 or summary["recommended_count"] != 11:
        raise RuntimeError("Default portfolio policy or quality gates changed")
    if summary["cost_month_rub"] != 59521.13 or summary["net_horizon_rub"] != 6626578.4:
        raise RuntimeError("Default portfolio economics differ from the documented release")
    if {p["data_sensitivity"] for p in assessment["processes"]} != {
        "public",
        "internal",
        "confidential",
        "personal",
    }:
        raise RuntimeError("Demo process data categories are incomplete")
    rows = assessment["result"]["portfolio_scenarios"]
    if len(rows) != 3:
        raise RuntimeError("Portfolio chart is missing scenarios")
    baseline = next(row for row in rows if row["key"] == "base")
    for field in ("implementation_rub", "net_month_rub", "net_horizon_rub", "payback_months"):
        if baseline[field] != assessment["result"]["summary"][field]:
            raise RuntimeError("Base cashflow and summary diverge")
    report = request("/api/assessments/demo/report.md")
    exported = request("/api/assessments/demo/export.csv")
    if not all(m["pricing_url"] in report for m in profiles["models"]):
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
    if {r["model_id"] for r in advice["model_options"]} != expected_ids:
        raise RuntimeError("Advisor omits a verified model")
    for row in advice["model_options"]:
        if not math.isclose(
            row["cost"]["total_usd"], prices[row["model_id"]]["monthly_usd"], abs_tol=1e-9
        ):
            raise RuntimeError("Advisor prices differ from the source calculator")
    for row in advice["model_options"]:
        cost = row["cost"]
        if abs(cost["input_usd"] + cost["output_usd"] - cost["total_usd"]) > 1e-10:
            raise RuntimeError("Cost chart components do not sum to the quote")
        if cost["requests_per_month"] != 10000:
            raise RuntimeError("Cost chart uses an incorrect request count")
    request(
        "/api/advice",
        {
            "task_type": "classification",
            "requests_per_month": 1,
            "tokens_in": 1,
            "tokens_out": 0,
            "must_self_host": True,
        },
        expected=422,
    )
    scenarios = []
    for period in ("peak", "off_peak"):
        scenarios.append(
            request(
                "/api/assess",
                {
                    "processes": assessment["processes"],
                    "assumptions": {
                        "model_preference": "cost",
                        "deepseek_period": period,
                        "supported_region": True,
                    },
                },
            )
        )
    if scenarios[1]["summary"]["cost_month_rub"] > scenarios[0]["summary"]["cost_month_rub"]:
        raise RuntimeError("DeepSeek period is disconnected from portfolio ROI")
    recalculated = request(
        "/api/assess", {"processes": assessment["processes"], "assumptions": {"horizon_months": 24}}
    )
    if recalculated["assumptions"]["horizon_months"] != 24:
        raise RuntimeError("What-if calculation failed")
    default_advice = request(
        "/api/advice",
        {
            "task_type": "classification",
            "requests_per_month": 1000,
            "tokens_in": 100,
            "tokens_out": 20,
        },
    )
    if any(r["model_id"] not in russian for r in default_advice["recommendations"]):
        raise RuntimeError("Foreign access is enabled without an explicit assumption")
    request(
        "/api/safety/analyze",
        {"text": "Синтетический пример: user@example.invalid", "declared_sensitivity": "public"},
    )
    request(
        "/api/prompts/lint",
        {"text": "Ты редактор. Составь список из трёх пунктов без персональных данных."},
    )
    request("/api/evals/measured", expected=410)
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
