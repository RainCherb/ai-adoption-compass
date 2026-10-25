"""Проверенные тарифы управляют подбором, каждым процессом и итоговой экономикой."""

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

RUSSIAN = [
    "yandexgpt-pro-5-1",
    "alice-ai-llm",
    "gigachat-2-max",
    "gigachat-2-pro",
    "gigachat-2-lite",
]
FOREIGN = [
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
    "gpt-6-1-sol",
    "gpt-6-luna",
    "deepseek-v4-1-flash",
    "deepseek-v4-pro",
]
IDS = RUSSIAN + FOREIGN


@pytest.fixture
def demo_services(settings):
    return build_services(replace(settings, demo_mode=True), with_storage=False)


@pytest.fixture
def processes():
    return parse_processes_csv(read_data_text("samples/processes.csv")).processes


def workload(**changes):
    return Workload.model_validate(
        {
            "task_type": "classification",
            "data_sensitivity": "public",
            "requests_per_month": 10000,
            "tokens_in": 1000,
            "tokens_out": 300,
            "prefer": "quality",
        }
        | changes
    )


def test_demo_compares_all_verified_models_with_shared_prices(demo_services, settings):
    assert [m.id for m in demo_services.catalog.models] == IDS
    advice = demo_services.advisor.recommend(workload(), top=20)
    # Без доступа к зарубежным API подходят только российские облака; остальные — с причиной.
    assert {r.model_id for r in advice.recommendations} == set(RUSSIAN)
    assert {e.model_id: e.kinds for e in advice.excluded} == {i: ["access"] for i in FOREIGN}
    reference = {
        line.model.id: line
        for line in compare_models(
            ModelComparisonRequest(), settings.current_date, usd_rub=demo_services.advisor.usd_rub
        ).models
    }
    assert [o.model_id for o in advice.model_options] == IDS
    for option in advice.model_options:
        direct = reference[option.model_id]
        assert option.cost.total_rub == round(direct.monthly_rub, 2)
        assert option.cost.total_usd == pytest.approx(direct.monthly_usd)
        assert option.cost.currency == direct.currency
        assert option.cost.vat_included == (direct.currency == "RUB")
        assert option.profile.quality_status == "not_measured"
        assert option.eligible == (option.model_id in RUSSIAN)


def test_every_process_uses_the_same_tariffs_in_model_cost_roi_and_scenarios(
    demo_services, processes
):
    result = demo_services.engine.assess(processes)
    assert len(result.processes) == 18
    source = {p.id: p for p in processes}
    fx = Decimal(str(result.assumptions.usd_rub))
    for row in result.processes:
        assert [o.model_id for o in row.model_options] == IDS
        if row.model is None:
            continue
        assert row.model.model_id in RUSSIAN
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
        native = (
            (
                Decimal(tokens_in) * Decimal(str(selected.cost.input_rate))
                + Decimal(tokens_out) * Decimal(str(selected.cost.output_rate))
            )
            * p.runs_per_month
            / 1000000
        )
        rub = native * fx if selected.cost.currency == "USD" else native
        assert selected.cost.total_rub == round(float(rub), 2)
        base = next(s for s in row.scenarios if s.key == "base")
        assert base.net_horizon_rub == row.net_horizon_rub
    # Анализ договоров и оценка контрагентов требуют качества 5/5, SQL — кода 4/5: среди
    # российских облаков таких моделей нет, поэтому три процесса заблокированы.
    assert result.summary.processes_blocked == 3
    assert result.summary.recommended_count == 11
    assert result.summary.cost_month_rub == 59521.13
    assert result.summary.net_horizon_rub == 6626578.4
    assert result.summary.roi_pct == 226.7


def test_deepseek_period_changes_only_deepseek_costs(demo_services, processes):
    common = {"model_preference": "cost", "supported_region": True}
    peak = demo_services.engine.assess(processes, common)
    off = demo_services.engine.assess(processes, common | {"deepseek_period": "off_peak"})
    assert any(p.model and p.model.model_id.startswith("deepseek") for p in peak.processes)
    by_id = {p.id: p for p in off.processes}
    for row in peak.processes:
        other = {o.model_id: o for o in by_id[row.id].model_options}
        for option in row.model_options:
            ratio = other[option.model_id].cost.total_usd / option.cost.total_usd
            assert ratio == pytest.approx(0.5 if option.model_id.startswith("deepseek") else 1)
    assert off.summary.cost_month_rub <= peak.summary.cost_month_rub


@pytest.mark.parametrize("sensitivity", ["personal", "confidential"])
def test_foreign_api_access_never_relaxes_data_policy(demo_services, sensitivity):
    result = demo_services.advisor.recommend(
        workload(data_sensitivity=sensitivity, supported_region=True), top=20
    )
    assert {r.model_id for r in result.recommendations} == set(RUSSIAN)
    assert all(r.requires_masking for r in result.recommendations)
    assert {e.model_id for e in result.excluded} == set(FOREIGN)
    assert all("policy" in e.kinds for e in result.excluded)


def test_foreign_api_access_is_an_explicit_assumption(demo_services, processes):
    without = demo_services.advisor.recommend(workload(), top=20)
    with_access = demo_services.advisor.recommend(workload(supported_region=True), top=20)
    assert not {r.model_id for r in without.recommendations} & set(FOREIGN)
    assert set(FOREIGN) <= {r.model_id for r in with_access.recommendations}
    default = demo_services.engine.assess(processes)
    region = demo_services.engine.assess(processes, {"supported_region": True})
    assert default.assumptions.supported_region is False
    assert all(p.model is None or p.model.model_id in RUSSIAN for p in default.processes)
    assert any(p.model and p.model.model_id in FOREIGN for p in region.processes)


@pytest.mark.parametrize(("tokens", "usd"), [(272000, 0.554), (272001, 1.103004)])
def test_gpt_threshold_is_shared_with_real_advisor(demo_services, tokens, usd):
    advice = demo_services.advisor.recommend(
        workload(requests_per_month=1, tokens_in=tokens, tokens_out=1000, supported_region=True)
    )
    options = {o.model_id: o for o in advice.model_options}
    assert options["gpt-6-1-sol"].cost.total_usd == pytest.approx(usd)


def test_modified_sources_cannot_create_fake_free_roi(settings, tmp_path, processes):
    bundle = json.loads(read_data_text("source-snapshots.json"))
    for snapshot in bundle["snapshots"]:
        snapshot["content_sha256"] = "0" * 64
    (tmp_path / "source-snapshots.json").write_text(json.dumps(bundle), encoding="utf-8")
    svc = build_services(replace(settings, demo_mode=True, data_dir=tmp_path), with_storage=False)
    advice = svc.advisor.recommend(workload())
    assert not advice.recommendations
    assert all(o.cost is None for o in advice.model_options)
    result = svc.engine.assess(processes)
    assert result.summary.processes_blocked == 18
    assert result.summary.recommended_count == 0
    assert result.summary.net_horizon_rub == 0
    with pytest.raises(ValueError, match="сверки"):
        svc.advisor.estimate_cost(svc.catalog.models[0], 1, 1000, 300)


def test_expired_sources_keep_estimates_but_warn(settings, processes, demo_services):
    late = replace(settings, demo_mode=True, today=settings.current_date + timedelta(days=45))
    svc = build_services(late, with_storage=False)
    advice = svc.advisor.recommend(workload())
    assert advice.recommendations
    assert all(o.cost and o.cost.price_warning for o in advice.model_options)
    assert any("давно не сверялись" in note for note in advice.notes)
    fresh = demo_services.engine.assess(processes).summary
    assert svc.engine.assess(processes).summary.net_horizon_rub == fresh.net_horizon_rub


def test_public_api_catalog_sample_and_exports_share_the_models(settings):
    with TestClient(create_app(replace(settings, demo_mode=True))) as client:
        catalog = client.get("/api/catalog").json()
        assert catalog["primary_model_ids"] == IDS
        assert [m["id"] for m in catalog["models"]] == IDS
        models = {m["id"]: m for m in catalog["models"]}
        stored = client.get("/api/assessments/demo").json()
        sample = parse_processes_csv(client.get("/api/samples/processes.csv").text)
        assert [p.model_dump(mode="json") for p in sample.processes] == stored["processes"]
        assert {p.data_sensitivity.value for p in sample.processes} == {
            "public",
            "internal",
            "confidential",
            "personal",
        }
        report = client.get("/api/assessments/demo/report.md").text
        results = {p["id"]: p for p in stored["result"]["processes"]}
        for result in results.values():
            if result["model"]:
                assert result["model"]["model_id"] in report
        for model in models.values():
            assert model["profile"]["pricing_url"] in report
        assert "экспертные допущения" in report
        assert "с НДС" in report
        rows = list(
            csv.DictReader(
                io.StringIO(client.get("/api/assessments/demo/export.csv").text.lstrip("\ufeff")),
                delimiter=";",
            )
        )
        assert len(rows) == 18
        for row in rows:
            result = results[row["id"]]
            if not result["model"]:
                continue
            expected = models[result["model"]["model_id"]]["profile"]["api_model"]
            assert row["model_api_id"] == expected
            assert float(row["llm_cost_month_rub"]) == result["llm_cost_month_rub"]
            assert float(row["llm_cost_month_usd"]) > 0
