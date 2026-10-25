import json
from datetime import timedelta

import pytest

from adoption_compass.featured_models import (
    DirectPricing,
    FeaturedCatalog,
    FeaturedModel,
    ModelComparisonRequest,
    compare_models,
    load_featured,
)
from adoption_compass.resources import read_data_text

from .conftest import TODAY

FX = 80.54
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


def _compare(request: ModelComparisonRequest, today=TODAY, data_dir=None):
    result = compare_models(request, today, data_dir, usd_rub=FX)
    return {line.model.id: line for line in result.models}


def test_profiles_cover_russian_and_foreign_providers_with_official_ids():
    catalog = load_featured()
    assert sorted(m.id for m in catalog.models) == sorted(RUSSIAN + FOREIGN)
    by_id = {m.id: m for m in catalog.models}
    assert by_id["claude-sonnet-5-5"].api_model == "claude-sonnet-5-5"
    assert by_id["gpt-6-1-sol"].api_model == "gpt-6.1-sol"
    assert by_id["deepseek-v4-1-flash"].api_model == "deepseek-flash"
    assert by_id["gigachat-2-max"].api_model == "GigaChat-2-Max"
    assert all(m.quality_status == "not_measured" for m in catalog.models)
    assert all(by_id[i].currency == "RUB" and by_id[i].vat_included for i in RUSSIAN)
    assert all(by_id[i].russia_api_status == "available" for i in RUSSIAN)
    assert all(by_id[i].currency == "USD" and not by_id[i].vat_included for i in FOREIGN)
    assert all(by_id[i].russia_api_status != "available" for i in FOREIGN)
    # Российские провайдеры не публикуют отдельный предел выхода — значение не выдумывается.
    assert all(by_id[i].max_output_tokens is None for i in RUSSIAN)


def test_default_cost_is_same_workload_for_every_model():
    rows = _compare(ModelComparisonRequest())
    usd = {i: rows[i].monthly_usd for i in FOREIGN}
    assert usd == pytest.approx(
        {
            "claude-sonnet-5-5": 50,
            "claude-haiku-5-5": 2.5,
            "gpt-6-1-sol": 50,
            "gpt-6-luna": 2.5,
            "deepseek-v4-1-flash": 6.6,
            "deepseek-v4-pro": 25.08,
        }
    )
    # 10 000 запросов × (1 000 входных + 300 выходных токенов) по рублёвым тарифам с НДС.
    rub = {i: rows[i].monthly_rub for i in RUSSIAN}
    assert rub == pytest.approx(
        {
            "yandexgpt-pro-5-1": 10_400,
            "alice-ai-llm": 8_600,
            "gigachat-2-max": 8_450,
            "gigachat-2-pro": 6_500,
            "gigachat-2-lite": 845,
        }
    )
    assert rows["claude-sonnet-5-5"].monthly_rub == pytest.approx(50 * FX)
    assert rows["yandexgpt-pro-5-1"].monthly_usd == pytest.approx(10_400 / FX)
    assert rows["deepseek-v4-1-flash"].input_usd == pytest.approx(3)
    assert rows["deepseek-v4-1-flash"].output_usd == pytest.approx(3.6)
    assert rows["alice-ai-llm"].per_request_rub == pytest.approx(0.86)


def test_off_peak_changes_only_deepseek_prices():
    peak, off = (
        _compare(ModelComparisonRequest()),
        _compare(ModelComparisonRequest(deepseek_period="off_peak")),
    )
    for model_id in peak:
        ratio = off[model_id].monthly_rub / peak[model_id].monthly_rub
        assert ratio == pytest.approx(0.5 if model_id.startswith("deepseek") else 1)


@pytest.mark.parametrize(("tokens", "expected"), [(272000, 0.554), (272001, 1.103004)])
def test_openai_long_context_threshold_applies_to_whole_request(tokens, expected):
    rows = _compare(ModelComparisonRequest(requests_per_month=1, tokens_in=tokens, tokens_out=1000))
    assert rows["gpt-6-1-sol"].monthly_usd == pytest.approx(expected)
    assert (rows["claude-sonnet-5-5"].input_rate, rows["claude-sonnet-5-5"].output_rate) == (2, 10)


@pytest.mark.parametrize(("tokens", "expected"), [(100_000, 0.0105), (100_001, 0.0525005)])
def test_haiku_prompts_over_100k_are_billed_at_the_higher_rate(tokens, expected):
    rows = _compare(ModelComparisonRequest(requests_per_month=1, tokens_in=tokens, tokens_out=1000))
    assert rows["claude-haiku-5-5"].monthly_usd == pytest.approx(expected)


def test_limits_hide_cost_for_models_that_cannot_serve_the_workload():
    rows = _compare(ModelComparisonRequest(tokens_out=128_001))
    available = {i for i, row in rows.items() if row.available}
    # 128K выхода превышает предел Claude/GPT и контекст российских моделей; DeepSeek допускает 384K.
    assert available == {"deepseek-v4-1-flash", "deepseek-v4-pro"}
    assert all(rows[i].monthly_rub is None for i in rows if i not in available)
    rows = _compare(ModelComparisonRequest(tokens_in=1_050_001, tokens_out=0))
    assert all(not r.available and r.monthly_rub is None for r in rows.values())


def test_zero_output_still_bills_input():
    rows = _compare(ModelComparisonRequest(tokens_out=0))
    assert rows["claude-sonnet-5-5"].monthly_usd == pytest.approx(20)
    assert rows["gigachat-2-lite"].monthly_rub == pytest.approx(650)


def test_stale_source_keeps_the_estimate_but_warns():
    rows = _compare(ModelComparisonRequest(), TODAY + timedelta(days=31))
    assert all(r.available and r.monthly_rub for r in rows.values())
    assert all(r.warning and "дн. назад" in r.warning for r in rows.values())
    assert all(r.warning is None for r in _compare(ModelComparisonRequest()).values())


def test_snapshot_from_the_future_fails_closed():
    rows = _compare(ModelComparisonRequest(), TODAY - timedelta(days=1))
    assert all(not r.available and r.monthly_rub is None for r in rows.values())


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
    rows = _compare(ModelComparisonRequest(), data_dir=tmp_path)
    assert rows["gpt-6-1-sol"].monthly_usd is None
    assert rows["claude-sonnet-5-5"].monthly_usd == pytest.approx(50)


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
    usd_with_vat = {**load_featured().models[0].model_dump(), "vat_included": True}
    with pytest.raises(ValueError, match="НДС"):
        FeaturedModel.model_validate(usd_with_vat)


def test_api_calculates_without_provider_calls(client, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Расчёт не должен ходить в сеть")

    monkeypatch.setattr("httpx.Client.send", forbidden)
    # TestClient использует собственный transport; запрос обрабатывается через ASGI напрямую.
    from adoption_compass.api.app import compare_featured, featured_models

    svc = client.app.state.services
    assert len(featured_models(svc).models) == 11
    lines = {line.model.id: line for line in compare_featured(ModelComparisonRequest(), svc).models}
    assert lines["yandexgpt-pro-5-1"].monthly_rub == pytest.approx(10_400)


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


def test_typed_api_returns_profiles_and_costs(client, settings):
    names = [m["name"] for m in client.get("/api/models/featured").json()["models"]]
    assert {"YandexGPT Pro 5.1", "GigaChat 2 Max", "Claude Sonnet 5.5"} <= set(names)
    response = client.post("/api/models/compare", json={})
    assert response.status_code == 200
    body = response.json()
    assert body["usd_rub"] == pytest.approx(80.54)
    rub = {r["model"]["id"]: r["monthly_rub"] for r in body["models"]}
    assert rub["gigachat-2-lite"] == pytest.approx(845)
    assert {r["currency"] for r in body["models"]} == {"RUB", "USD"}
