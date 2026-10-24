import json

import httpx
import pytest

from adoption_compass.evals.benchmark import load_benchmark
from adoption_compass.evals.providers import OpenAICompatibleProvider, ProviderError
from adoption_compass.resources import read_data_text


def test_published_run_has_three_real_models_and_traceable_metrics(client):
    artifact = load_benchmark()
    assert len(artifact.runs) == 3
    assert len(artifact.reports) == 4
    assert all(report.n == 72 for report in artifact.reports)
    assert all(len(run.observations) == 72 for run in artifact.runs)
    assert all(run.provider.startswith("local:") for run in artifact.runs)
    assert all(report.cost_rub is None for report in artifact.reports if not report.is_baseline)
    baseline = next(r for r in artifact.reports if r.is_baseline)
    assert baseline.metrics.accuracy > max(
        r.metrics.accuracy for r in artifact.reports if not r.is_baseline
    )
    measured = client.get("/api/evals/measured")
    assert measured.status_code == 200
    assert measured.json()["kind"] == "measured"
    assert measured.json()["provenance"]["dataset_sha256"] == artifact.dataset_sha256
    assert client.get("/api/evals/demo").json()["kind"] == "simulated"


@pytest.mark.parametrize("mutation", ["dataset", "prompt", "prediction", "metrics", "incomplete"])
def test_tampered_or_outdated_artifact_is_rejected(tmp_path, mutation):
    artifact = json.loads(read_data_text("evals/measured.json"))
    if mutation == "dataset":
        artifact["dataset_sha256"] = "0" * 64
    elif mutation == "prompt":
        artifact["prompt_sha256"] = "0" * 64
    elif mutation == "prediction":
        artifact["runs"][0]["observations"][0]["predicted"] = "other"
    elif mutation == "metrics":
        artifact["reports"][1]["metrics"]["accuracy"] = 1
    else:
        artifact["runs"][0]["observations"].pop()
    (tmp_path / "evals").mkdir()
    (tmp_path / "evals/measured.json").write_text(json.dumps(artifact), encoding="utf-8")
    with pytest.raises(ValueError, match=r"изменились|соответствует|соответствуют|Неполный"):
        load_benchmark(tmp_path)


@pytest.mark.parametrize(
    "usage", [{"prompt_tokens": -1}, {"prompt_tokens": "NaN"}, {"completion_tokens": True}, [1]]
)
def test_bad_usage_is_a_provider_error(usage):
    provider = OpenAICompatibleProvider(
        "http://localhost/v1",
        "test",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, json={"choices": [{"message": {"content": "ok"}}], "usage": usage}
            )
        ),
    )
    try:
        with pytest.raises(ProviderError, match=r"usage|токенов"):
            provider.complete("system", "user")
    finally:
        provider.close()
