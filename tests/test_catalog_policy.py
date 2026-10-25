from datetime import date, timedelta
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from adoption_compass.catalog import Catalog, ModelEntry, Pricing, load_catalog
from adoption_compass.domain import Action, Deployment, Sensitivity, TaskType
from adoption_compass.resources import read_data_text
from adoption_compass.safety import Policy, PolicyDocument

TODAY = date(2026, 10, 25)


def _model(**overrides):
    base = {
        "id": "m1",
        "name": "Model",
        "vendor": "V",
        "family": "F",
        "tier": "economy",
        "deployment": "ru_cloud",
        "origin": "Россия",
        "ru_access": "direct",
        "pricing": {"currency": "RUB", "input_per_mtok": 1, "output_per_mtok": 1},
        "context_window": 1000,
        "quality": {t.value: 3 for t in TaskType},
        "reviewed_at": TODAY,
    }
    return {**base, **overrides}


class TestCatalog:
    def test_bundled_catalog_is_valid_and_covers_all_deployments(self):
        catalog = load_catalog()
        assert len(catalog.models) >= 12
        assert {m.deployment for m in catalog.models} == set(Deployment)
        assert catalog.data_status == "illustrative"

    def test_every_model_rates_every_task_type(self):
        for model in load_catalog().models:
            assert set(model.quality) == set(TaskType), model.id

    def test_self_hosted_models_declare_capacity(self):
        for model in load_catalog().models:
            if model.deployment is Deployment.SELF_HOSTED:
                assert model.pricing.fixed_monthly > 0
                assert model.pricing.capacity_mtok_month

    def test_get_returns_model_and_raises_for_unknown(self):
        catalog = load_catalog()
        assert catalog.get("gigachat-2-max").vendor == "Сбер"
        assert catalog.get("gigachat-2-max").pricing.currency == "RUB"
        with pytest.raises(KeyError):
            catalog.get("nope")

    def test_stale_entries_are_sorted_oldest_first(self):
        catalog = Catalog(
            as_of=TODAY,
            models=[
                ModelEntry.model_validate(
                    _model(id="fresh", reviewed_at=TODAY - timedelta(days=10))
                ),
                ModelEntry.model_validate(
                    _model(id="old", reviewed_at=TODAY - timedelta(days=200))
                ),
                ModelEntry.model_validate(
                    _model(id="older", reviewed_at=TODAY - timedelta(days=400))
                ),
            ],
        )
        stale = catalog.stale_entries(TODAY, max_age_days=90)
        assert [s.id for s in stale] == ["older", "old"]
        assert stale[0].age_days == 400

    def test_entry_at_exact_limit_is_not_stale(self):
        entry = ModelEntry.model_validate(_model(reviewed_at=TODAY - timedelta(days=90)))
        assert Catalog(as_of=TODAY, models=[entry]).stale_entries(TODAY, 90) == []

    def test_missing_quality_rating_is_rejected(self):
        quality = {t.value: 3 for t in TaskType}
        del quality["code"]
        with pytest.raises(ValidationError, match="code"):
            ModelEntry.model_validate(_model(quality=quality))

    def test_quality_out_of_range_is_rejected(self):
        quality = {t.value: 3 for t in TaskType} | {"code": 6}
        with pytest.raises(ValidationError, match="от 1 до 5"):
            ModelEntry.model_validate(_model(quality=quality))

    def test_fixed_cost_requires_capacity(self):
        with pytest.raises(ValidationError, match="capacity_mtok_month"):
            Pricing(currency="RUB", input_per_mtok=0, output_per_mtok=0, fixed_monthly=100)

    def test_duplicate_ids_are_rejected(self):
        entry = ModelEntry.model_validate(_model())
        with pytest.raises(ValidationError, match="повторяющийся"):
            Catalog(as_of=TODAY, models=[entry, entry])

    def test_data_dir_overrides_bundled_catalog(self, tmp_path: Path):
        document = yaml.safe_load(read_data_text("catalog.yaml"))
        document["models"] = document["models"][:2]
        (tmp_path / "catalog.yaml").write_text(
            yaml.safe_dump(document, allow_unicode=True), encoding="utf-8"
        )
        assert len(load_catalog(tmp_path).models) == 2
        assert len(load_catalog().models) > 2


class TestPolicy:
    @pytest.fixture
    def policy(self) -> Policy:
        return Policy.load()

    @pytest.mark.parametrize(
        ("sensitivity", "deployment", "expected"),
        [
            (Sensitivity.PUBLIC, Deployment.FOREIGN_CLOUD, Action.ALLOW),
            (Sensitivity.INTERNAL, Deployment.FOREIGN_CLOUD, Action.MASK),
            (Sensitivity.CONFIDENTIAL, Deployment.FOREIGN_CLOUD, Action.DENY),
            (Sensitivity.PERSONAL, Deployment.FOREIGN_CLOUD, Action.DENY),
            (Sensitivity.PERSONAL, Deployment.RU_CLOUD, Action.MASK),
            (Sensitivity.PERSONAL, Deployment.SELF_HOSTED, Action.ALLOW),
        ],
    )
    def test_matrix(self, policy, sensitivity, deployment, expected):
        assert policy.action(sensitivity, deployment) is expected

    def test_personal_data_never_goes_to_foreign_cloud(self, policy):
        assert Deployment.FOREIGN_CLOUD not in policy.allowed_deployments(Sensitivity.PERSONAL)
        assert Deployment.FOREIGN_CLOUD in policy.allowed_deployments(Sensitivity.PUBLIC)

    def test_self_hosted_is_never_less_safe_than_other_options(self, policy):
        for level in Sensitivity:
            scores = {d: policy.safety_score(level, d) for d in Deployment}
            assert scores[Deployment.SELF_HOSTED] == max(scores.values())

    def test_incomplete_matrix_is_rejected(self):
        import yaml as _yaml

        raw = _yaml.safe_load(read_data_text("policy.yaml"))
        del raw["matrix"]["personal"]["self_hosted"]
        with pytest.raises(ValidationError, match="все размещения"):
            PolicyDocument.model_validate(raw)

    def test_handout_contains_matrix_rules_and_disclaimer(self, policy):
        text = policy.handout_markdown()
        assert text.startswith("# Памятка")
        assert "⛔ Нельзя" in text
        assert "🟡 После обезличивания" in text
        assert "✅ Можно" in text
        assert "юридической консультацией" in text
        assert all(item in text for item in policy.document.do + policy.document.dont)
