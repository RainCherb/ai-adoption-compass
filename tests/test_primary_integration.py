"""Прямые тарифы должны управлять подбором, каждым процессом и итоговой экономикой."""

import csv
import io
import json
import math
from dataclasses import replace
from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from adoption_compass.advisor import Workload
from adoption_compass.api import create_app
from adoption_compass.csv_io import parse_processes_csv
from adoption_compass.featured_models import ModelComparisonRequest, compare_models
from adoption_compass.resources import read_data_text
from adoption_compass.services import build_services

IDS = ["claude-sonnet-5-5", "gpt-6-1-sol", "deepseek-v4-1-flash"]


@pytest.fixture
def demo_services(settings):
    return build_services(replace(settings, demo_mode=True), with_storage=False)


@pytest.fixture
def processes():
    return parse_processes_csv(read_data_text("samples/demo-processes.csv")).processes


def workload(**changes):
    return Workload.model_validate(
        {
            "task_type": "classification",
            "data_sensitivity": "public",
            "requests_per_month": 10000,
            "tokens_in": 1000,
            "tokens_out": 300,
            "supported_region": True,
            "prefer": "quality",
        }
        | changes
    )


def test_advisor_uses_three_actual_profiles_and_shared_prices(demo_services, settings):
    assert [m.id for m in demo_services.catalog.models] == IDS
    advice = demo_services.advisor.recommend(workload())
    assert [r.model_id for r in advice.recommendations] == IDS
    assert [r.score for r in advice.recommendations] == [90, 90, 85]
    assert [r.quality for r in advice.recommendations] == [5, 5, 4]
    reference = compare_models(ModelComparisonRequest(), settings.current_date)
    for row, direct in zip(advice.model_options, reference.models, strict=True):
        assert row.cost.total_usd == direct.monthly_usd
        assert row.cost.total_rub == round(direct.monthly_usd * 90, 2)
        assert row.profile.quality_status == "not_measured"
        assert row.eligible


def test_every_process_uses_the_same_tariffs_in_model_cost_roi_and_scenarios(
    demo_services, processes
):
    result = demo_services.engine.assess(processes)
    assert len(result.processes) == 18
    source = {p.id: p for p in processes}
    for row in result.processes:
        assert row.model.model_id in IDS
        assert [o.model_id for o in row.model_options] == IDS
        selected = next(o for o in row.model_options if o.model_id == row.model.model_id)
        assert selected.cost == row.model.cost
        assert row.llm_cost_month_rub == selected.cost.total_rub
        p = source[row.id]
        profile = demo_services.scoring.task_types[p.task_type]
        tokens_in = math.ceil((p.tokens_in or profile.tokens_in) * result.assumptions.llm_overhead)
        tokens_out = math.ceil(
            (p.tokens_out if p.tokens_out is not None else profile.tokens_out)
            * result.assumptions.llm_overhead
        )
        usd = (
            (
                Decimal(tokens_in) * Decimal(str(selected.cost.input_rate_usd))
                + Decimal(tokens_out) * Decimal(str(selected.cost.output_rate_usd))
            )
            * p.runs_per_month
            / 1000000
        )
        assert selected.cost.total_usd == float(usd)
        assert selected.cost.total_rub == round(float(usd * 90), 2)
        base = next(s for s in row.scenarios if s.key == "base")
        assert base.net_horizon_rub == row.net_horizon_rub
    assert result.summary.processes_blocked == 0
    assert result.summary.recommended_count == 12
    assert result.summary.cost_month_rub == 67877.16
    assert result.summary.net_horizon_rub == 7294391.04
    assert result.summary.roi_pct == 224.3


def test_cost_preference_and_period_recompute_entire_portfolio(demo_services, processes):
    peak = demo_services.engine.assess(processes, {"model_preference": "cost"})
    off = demo_services.engine.assess(
        processes, {"model_preference": "cost", "deepseek_period": "off_peak"}
    )
    deep = [p for p in peak.processes if p.model.model_id == IDS[2]]
    assert deep
    by_id = {p.id: p for p in off.processes}
    for row in peak.processes:
        other = by_id[row.id]
        assert other.model_options[0].cost == row.model_options[0].cost
        assert other.model_options[1].cost == row.model_options[1].cost
        assert other.model_options[2].cost.total_usd == row.model_options[2].cost.total_usd / 2
    assert off.summary.cost_month_rub < peak.summary.cost_month_rub
    assert off.summary.net_horizon_rub > peak.summary.net_horizon_rub


@pytest.mark.parametrize("sensitivity", ["personal", "confidential"])
def test_supported_region_never_relaxes_data_policy(demo_services, sensitivity):
    result = demo_services.advisor.recommend(workload(data_sensitivity=sensitivity))
    assert not result.recommendations
    assert all("policy" in r.kinds for r in result.excluded)
    assert all(not o.eligible for o in result.model_options)


def test_access_assumption_is_explicit_and_can_block_entire_demo(demo_services, processes):
    assert not demo_services.advisor.recommend(workload(supported_region=False)).recommendations
    result = demo_services.engine.assess(processes, {"supported_region": False})
    assert result.summary.processes_blocked == 18
    assert result.summary.recommended_count == 0
    assert result.summary.net_horizon_rub == 0


@pytest.mark.parametrize(("tokens", "usd"), [(272000, 0.554), (272001, 1.103004)])
def test_gpt_threshold_is_shared_with_real_advisor(demo_services, tokens, usd):
    advice = demo_services.advisor.recommend(
        workload(requests_per_month=1, tokens_in=tokens, tokens_out=1000)
    )
    assert advice.model_options[1].cost.total_usd == usd


@pytest.mark.parametrize("failure", ["expiry", "hash"])
def test_expired_or_modified_sources_cannot_create_fake_free_roi(
    settings, tmp_path, processes, failure
):
    if failure == "expiry":
        settings = replace(settings, today=settings.current_date + timedelta(days=8))
    else:
        bundle = json.loads(read_data_text("source-snapshots.json"))
        for snapshot in bundle["snapshots"]:
            snapshot["content_sha256"] = "0" * 64
        (tmp_path / "source-snapshots.json").write_text(json.dumps(bundle), encoding="utf-8")
        settings = replace(settings, data_dir=tmp_path)
    svc = build_services(replace(settings, demo_mode=True), with_storage=False)
    advice = svc.advisor.recommend(workload())
    assert not advice.recommendations
    assert all(o.cost is None for o in advice.model_options)
    result = svc.engine.assess(processes)
    assert result.summary.processes_blocked == 18
    assert result.summary.recommended_count == 0
    assert result.summary.net_horizon_rub == 0
    with pytest.raises(ValueError, match="сверки"):
        svc.advisor.estimate_cost(svc.catalog.models[0], 1, 1000, 300)


def test_public_api_catalog_sample_and_exports_share_the_primary_models(settings):
    with TestClient(create_app(replace(settings, demo_mode=True))) as client:
        catalog = client.get("/api/catalog").json()
        assert catalog["primary_model_ids"] == IDS
        assert [m["id"] for m in catalog["models"]] == IDS
        stored = client.get("/api/assessments/demo").json()
        sample = parse_processes_csv(client.get("/api/samples/processes.csv").text)
        assert [p.model_dump(mode="json") for p in sample.processes] == stored["processes"]
        assert all(p.data_sensitivity.value == "public" for p in sample.processes)
        report = client.get("/api/assessments/demo/report.md").text
        for m in catalog["models"]:
            assert m["profile"]["api_model"] in report
            assert m["profile"]["pricing_url"] in report
        assert "экспертные допущения" in report
        rows = list(
            csv.DictReader(
                io.StringIO(client.get("/api/assessments/demo/export.csv").text.lstrip("\ufeff")),
                delimiter=";",
            )
        )
        assert len(rows) == 18
        results = {p["id"]: p for p in stored["result"]["processes"]}
        for row in rows:
            assert row["model_api_id"] in [m["profile"]["api_model"] for m in catalog["models"]]
            assert float(row["llm_cost_month_rub"]) == results[row["id"]]["llm_cost_month_rub"]
            assert float(row["llm_cost_month_usd"]) > 0
