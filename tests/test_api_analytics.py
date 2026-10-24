from dataclasses import replace
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from adoption_compass.api import create_app
from adoption_compass.csv_io import parse_processes_csv
from adoption_compass.resources import read_data_text
from adoption_compass.services import build_services


@pytest.mark.parametrize("demo_mode", [False, True])
def test_product_only_exposes_api_models_and_data_policy(settings, demo_mode):
    with TestClient(create_app(replace(settings, demo_mode=demo_mode))) as client:
        assert all(
            m["deployment"] != "self_hosted" for m in client.get("/api/catalog").json()["models"]
        )
        assert [d["value"] for d in client.get("/api/meta").json()["deployments"]] == [
            "ru_cloud",
            "foreign_cloud",
        ]
        policy = client.get("/api/safety/policy").json()
        assert all("self_hosted" not in row for row in policy["matrix"].values())
        assert "Self-hosted" not in policy["handout_markdown"]
        request = {
            "task_type": "classification",
            "requests_per_month": 1,
            "tokens_in": 1,
            "tokens_out": 0,
            "must_self_host": True,
        }
        assert client.post("/api/advice", json=request).status_code == 422


@pytest.mark.parametrize("period", ["peak", "off_peak"])
def test_cost_chart_components_conserve_official_quote(settings, period):
    with TestClient(create_app(replace(settings, demo_mode=True))) as client:
        result = client.post(
            "/api/advice",
            json={
                "task_type": "classification",
                "data_sensitivity": "public",
                "supported_region": True,
                "requests_per_month": 10000,
                "tokens_in": 1000,
                "tokens_out": 300,
                "deepseek_period": period,
            },
        ).json()
        costs = [row["cost"] for row in result["model_options"]]
        assert [c["input_usd"] for c in costs] == [20, 20, 3 if period == "peak" else 1.5]
        assert [c["output_usd"] for c in costs] == [30, 30, 3.6 if period == "peak" else 1.8]
        for cost in costs:
            assert cost["input_usd"] + cost["output_usd"] == pytest.approx(cost["total_usd"])
            assert cost["requests_per_month"] == 10000


@pytest.mark.parametrize("horizon", [1, 12, 24, 60])
def test_portfolio_curves_match_summary_and_sensitivity_formulas(settings, horizon):
    svc = build_services(replace(settings, demo_mode=True), with_storage=False)
    processes = parse_processes_csv(read_data_text("samples/demo-processes.csv")).processes
    result = svc.engine.assess(processes, {"horizon_months": horizon})
    base = next(row for row in result.portfolio_scenarios if row.key == "base")
    assert base.implementation_rub == result.summary.implementation_rub
    assert base.net_horizon_rub == result.summary.net_horizon_rub
    assert base.net_month_rub == result.summary.net_month_rub
    assert base.payback_months == result.summary.payback_months
    selected = [p for p in result.processes if p.wave is not None]
    llm = sum(Decimal(str(p.llm_cost_month_rub)) for p in selected)
    for row in result.portfolio_scenarios:
        if row.key == "base":
            continue
        factors = svc.scoring.scenarios[row.key]
        implementation = Decimal(str(result.summary.implementation_rub)) * Decimal(
            str(factors.implementation)
        )
        benefit = Decimal(str(result.summary.benefit_month_rub)) * Decimal(str(factors.savings))
        cost = llm * Decimal(str(factors.llm_cost)) + implementation * Decimal(
            str(result.assumptions.support_share_per_month)
        )
        assert row.implementation_rub == float(round(implementation, 2))
        assert row.net_horizon_rub == pytest.approx(
            float(round((benefit - cost) * horizon - implementation, 2)), abs=0.01
        )


def test_unavailable_models_produce_no_investment_or_fake_profit(settings):
    svc = build_services(replace(settings, demo_mode=True), with_storage=False)
    processes = parse_processes_csv(read_data_text("samples/demo-processes.csv")).processes
    result = svc.engine.assess(processes, {"supported_region": False})
    assert all(
        row.implementation_rub == 0 and row.net_horizon_rub == 0
        for row in result.portfolio_scenarios
    )


def test_russian_access_is_explicit_but_unknown_is_not_invented(settings):
    svc = build_services(settings, with_storage=False)
    profiles = [svc.catalog.get(model_id).profile for model_id in svc.catalog.primary_model_ids]
    assert [p.russia_api_status for p in profiles] == ["unavailable", "unavailable", "unverified"]
    assert all(p.access_url and p.access_reviewed_at and len(p.best_for) >= 3 for p in profiles)


def test_local_measurements_are_archived_outside_public_api_demo(settings):
    with TestClient(create_app(replace(settings, demo_mode=True))) as client:
        response = client.get("/api/evals/measured")
        assert response.status_code == 410
        assert "reports" not in response.json()
        process = client.get("/api/assessments/demo").json()["processes"][0]
        process["must_self_host"] = True
        assert client.post("/api/assess", json={"processes": [process]}).status_code == 422


def test_sub_kopeck_budget_does_not_make_a_paid_api_free(settings):
    with TestClient(create_app(replace(settings, demo_mode=True))) as client:
        result = client.post(
            "/api/advice",
            json={
                "task_type": "classification",
                "data_sensitivity": "public",
                "supported_region": True,
                "requests_per_month": 1,
                "tokens_in": 1,
                "tokens_out": 0,
                "monthly_budget_rub": 0.0000001,
            },
        ).json()
        assert not result["recommendations"]
        assert all(not row["eligible"] for row in result["model_options"])
        assert all(row["cost"]["total_usd"] > 0 for row in result["model_options"])
