import json
from datetime import timedelta

import pytest

from adoption_compass.featured_models import (
    DirectPricing,
    FeaturedCatalog,
    ModelComparisonRequest,
    compare_models,
    load_featured,
)
from adoption_compass.resources import read_data_text

from .conftest import TODAY


def test_primary_order_and_official_model_ids():
    catalog = load_featured()
    assert [m.api_model for m in catalog.models] == [
        "claude-sonnet-5-5",
        "gpt-6.1-sol",
        "deepseek-flash",
    ]
    assert all(m.quality_status == "not_measured" for m in catalog.models)
    assert [m.context_label for m in catalog.models] == ["1M", "1 050 000", "1M"]
    assert [m.max_output_tokens for m in catalog.models] == [128000, 128000, 384000]


def test_default_cost_is_same_workload_for_every_model():
    result = compare_models(ModelComparisonRequest(), TODAY)
    assert [r.monthly_usd for r in result.models] == [50, 50, 6.6]
    assert [r.input_usd for r in result.models] == [20, 20, 3]
    assert [r.output_usd for r in result.models] == [30, 30, 3.6]
    assert [r.per_request_usd for r in result.models] == [0.005, 0.005, 0.00066]


def test_off_peak_halves_only_deepseek_price():
    result = compare_models(ModelComparisonRequest(deepseek_period="off_peak"), TODAY)
    assert [r.monthly_usd for r in result.models] == [50, 50, 3.3]


@pytest.mark.parametrize(("tokens", "expected"), [(272000, 0.554), (272001, 1.103004)])
def test_openai_long_context_threshold_applies_to_whole_request(tokens, expected):
    result = compare_models(
        ModelComparisonRequest(requests_per_month=1, tokens_in=tokens, tokens_out=1000), TODAY
    )
    assert result.models[1].monthly_usd == expected
    assert result.models[0].input_rate == 2
    assert result.models[0].output_rate == 10


def test_invalid_volume_does_not_show_cost_for_unsupported_models():
    result = compare_models(ModelComparisonRequest(tokens_out=128001), TODAY)
    assert [r.available for r in result.models] == [False, False, True]
    assert all(r.monthly_usd is None for r in result.models[:2])
    result = compare_models(ModelComparisonRequest(tokens_in=1_050_001, tokens_out=0), TODAY)
    assert all(not r.available and r.monthly_usd is None for r in result.models)


def test_zero_output_still_bills_input():
    result = compare_models(ModelComparisonRequest(tokens_out=0), TODAY)
    assert [r.monthly_usd for r in result.models] == [20, 20, 3]


@pytest.mark.parametrize("days", [-1, 8, 30])
def test_future_or_stale_source_fails_closed(days):
    result = compare_models(ModelComparisonRequest(), TODAY + timedelta(days=days))
    assert all(not r.available and r.monthly_usd is None for r in result.models)


@pytest.mark.parametrize("change", ["hash", "url", "status", "reviewer", "date"])
def test_review_is_bound_to_exact_source_snapshot(tmp_path, change):
    for name in ("featured-models.yaml", "sources.yaml", "source-snapshots.json"):
        (tmp_path / name).write_text(read_data_text(name), encoding="utf-8")
    path = tmp_path / "source-snapshots.json"
    bundle = json.loads(path.read_text(encoding="utf-8"))
    source = next(s for s in bundle["snapshots"] if s["source_id"] == "openai-sol-model")
    key, value = {
        "hash": ("content_sha256", "0" * 64),
        "url": ("url", "https://example.invalid"),
        "status": ("status", "review_required"),
        "reviewer": ("reviewed_by", ""),
        "date": ("reviewed_at", "2026-10-23T12:00:00Z"),
    }[change]
    source[key] = value
    path.write_text(json.dumps(bundle), encoding="utf-8")
    rows = compare_models(ModelComparisonRequest(), TODAY, tmp_path).models
    assert rows[1].monthly_usd is None
    assert rows[0].monthly_usd == 50


def test_invalid_tariff_schema_rejected():
    with pytest.raises(ValueError, match="off-peak"):
        DirectPricing(
            input_per_mtok=1,
            output_per_mtok=1,
            cached_input_per_mtok=0,
            off_peak_input_per_mtok=0.5,
        )
    data = load_featured().model_dump()
    data["models"].append(data["models"][0])
    with pytest.raises(ValueError, match="повторяющаяся"):
        FeaturedCatalog.model_validate(data)


def test_api_calculates_without_provider_calls(client, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Расчёт не должен ходить в сеть")

    monkeypatch.setattr("httpx.Client.send", forbidden)
    # TestClient использует собственный transport; запрос обрабатывается через ASGI напрямую.
    from adoption_compass.api.app import compare_featured, featured_models

    svc = client.app.state.services
    assert len(featured_models(svc).models) == 3
    assert compare_featured(ModelComparisonRequest(), svc).models[0].monthly_usd == 50


@pytest.mark.parametrize(
    "body",
    [
        {"requests_per_month": 0},
        {"tokens_in": 1e308},
        {"tokens_in": True},
        {"tokens_out": -1},
        {"tokens_out": 384001},
        {"deepseek_period": "auto"},
        {"secret": "x"},
    ],
)
def test_api_rejects_bad_comparison_values(client, body):
    assert client.post("/api/models/compare", json=body).status_code == 422


def test_typed_api_returns_profiles_and_costs(client):
    assert client.get("/api/models/featured").json()["models"][0]["name"] == "Claude Sonnet 5.5"
    response = client.post("/api/models/compare", json={})
    assert response.status_code == 200
    assert [r["monthly_usd"] for r in response.json()["models"]] == [50, 50, 6.6]
