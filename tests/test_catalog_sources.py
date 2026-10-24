import json
from datetime import timedelta

import httpx
import pytest
from pydantic import ValidationError

from adoption_compass.catalog_sources import (
    SourceBundle,
    SourceRegistry,
    SourceSpec,
    load_registry,
    load_source_bundle,
    parse_openrouter,
    refresh_sources,
    review_snapshot,
    source_status,
    write_bundle,
)


def spec():
    return SourceSpec(
        id="test",
        title="Test",
        url="https://openrouter.ai/api/v1/models",
        kind="openrouter",
        max_age_days=7,
        model_ids=["test/model"],
    )


def response(price="0.000001"):
    return {
        "data": [
            {
                "id": "test/model",
                "name": "Model",
                "pricing": {"prompt": price, "completion": "0.000002"},
                "context_length": 1000,
            }
        ]
    }


@pytest.mark.parametrize(
    "url",
    [
        "http://openrouter.ai/api",
        "https://localhost/api",
        "https://openrouter.ai.evil.test/api",
        "https://user:password@openrouter.ai/api",
        "https://openrouter.ai:8080/api",
    ],
)
def test_registry_rejects_untrusted_urls(url):
    with pytest.raises(ValidationError):
        spec().model_copy().model_validate({**spec().model_dump(), "url": url})


def test_duplicate_sources_rejected():
    with pytest.raises(ValidationError):
        SourceRegistry(sources=[spec(), spec()])


def test_normalization_and_free_prices_are_valid():
    offer = parse_openrouter(json.dumps(response()).encode(), spec())[0]
    assert (offer.input_per_mtok, offer.output_per_mtok) == (1, 2)
    assert parse_openrouter(json.dumps(response("0")).encode(), spec())[0].input_per_mtok == 0


@pytest.mark.parametrize(
    "payload", [{}, {"data": []}, response("NaN"), response("-1"), {"data": "wrong"}]
)
def test_format_changes_fail_closed(payload):
    with pytest.raises(ValueError, match="Изменился формат"):
        parse_openrouter(json.dumps(payload).encode(), spec())


def test_refresh_records_failures_and_never_follows_redirects(tmp_path):
    for status in (200, 302, 500):
        with httpx.Client(
            transport=httpx.MockTransport(
                lambda request, status=status: httpx.Response(
                    status, json=response(), headers={"location": "http://localhost/secret"}
                )
            )
        ) as client:
            result = refresh_sources(SourceRegistry(sources=[spec()]), client)
        snapshot = result.snapshots[0]
        assert snapshot.status == ("machine_checked" if status == 200 else "unavailable")
        assert bool(snapshot.offers) == (status == 200)
        target = tmp_path / "sources.json"
        write_bundle(result, target)
        assert SourceBundle.model_validate_json(target.read_text(encoding="utf-8")) == result


def test_missing_or_unavailable_or_old_snapshot_is_not_fresh(tmp_path):
    registry = load_registry()
    bundle = load_source_bundle()
    latest = max(s.fetched_at.date() for s in bundle.snapshots)
    rows = source_status(latest + timedelta(days=91))["sources"]
    assert all(row["stale"] for row in rows)
    (tmp_path / "source-snapshots.json").write_text('{"snapshots": []}', encoding="utf-8")
    assert len(source_status(latest, tmp_path)["sources"]) == len(registry.sources)
    assert all(row["stale"] for row in source_status(latest, tmp_path)["sources"])


def test_api_sources_uses_snapshot_only(client, monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("API must not use network")

    monkeypatch.setattr(httpx.Client, "stream", blocked)
    body = client.get("/api/catalog/sources").json()
    assert next(s for s in body["sources"] if s["id"] == "openrouter-models")["snapshot"]["offers"]


def test_review_requires_exact_hash_and_available_source():
    with httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response()))
    ) as client:
        bundle = refresh_sources(SourceRegistry(sources=[spec()]), client)
    sha = bundle.snapshots[0].content_sha256
    reviewed = review_snapshot(
        bundle, "test", sha, "Maintainer", "Проверены тарифы и ограничения доступа"
    )
    assert reviewed.snapshots[0].status == "reviewed"
    assert reviewed.snapshots[0].reviewed_by == "Maintainer"
    assert bundle.snapshots[0].status == "machine_checked"
    with pytest.raises(ValueError, match="SHA-256"):
        review_snapshot(bundle, "test", "0" * 64, "Maintainer", "Проверены условия")
    bundle.snapshots[0].status = "unavailable"
    with pytest.raises(ValueError, match="SHA-256"):
        review_snapshot(bundle, "test", sha, "Maintainer", "Проверены условия")
