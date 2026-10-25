from datetime import date, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from adoption_compass.advisor import Advisor, Preference, Workload
from adoption_compass.catalog import load_catalog
from adoption_compass.domain import Deployment, RuAccess, Sensitivity, TaskType
from adoption_compass.safety import Policy

TODAY = date(2026, 10, 25)


@pytest.fixture(scope="module")
def advisor() -> Advisor:
    return Advisor(load_catalog(), Policy.load(), usd_rub=90.0, today=TODAY)


def workload(**overrides) -> Workload:
    base = {
        "task_type": TaskType.CLASSIFICATION,
        "data_sensitivity": Sensitivity.INTERNAL,
        "requests_per_month": 10_000,
        "tokens_in": 700,
        "tokens_out": 60,
    }
    return Workload.model_validate({**base, **overrides})


class TestCost:
    def test_per_token_cost_in_rubles(self, advisor):
        model = advisor.catalog.get("gigachat-2-max")  # 650 ₽ за 1 млн токенов с НДС
        cost = advisor.estimate_cost(model, 20_000, 700, 60)
        assert cost.variable_rub == pytest.approx(9_880)
        assert cost.fixed_rub == 0
        assert cost.total_rub == pytest.approx(9_880)

    def test_usd_prices_are_converted_with_exchange_rate(self, advisor):
        model = advisor.catalog.get("claude-sonnet-5-5")
        # 1 млн входных × $2 + 0.5 млн выходных × $10 = $7
        cost = advisor.estimate_cost(model, 1_000, 1_000, 500)
        assert cost.total_rub == pytest.approx(7 * 90)
        assert (cost.currency, cost.input_rate_usd, cost.vat_included) == ("USD", 2, False)

    def test_rub_tariffs_keep_their_currency_and_vat(self, advisor):
        model = advisor.catalog.get("alice-ai-llm")  # 500 ₽ вход и 1 200 ₽ выход за 1 млн, с НДС
        cost = advisor.estimate_cost(model, 1_000, 1_000, 500)
        assert cost.total_rub == pytest.approx(500 + 600)
        assert cost.total_usd == pytest.approx(1_100 / 90)
        assert (cost.currency, cost.input_rate, cost.output_rate) == ("RUB", 500, 1200)
        assert cost.vat_included is True
        assert cost.input_rate_usd is None

    def test_self_hosted_cost_scales_in_capacity_blocks(self, advisor):
        model = advisor.catalog.get("qwen-small-selfhost")  # 70 000 ₽, 300 млн токенов на блок
        small = advisor.estimate_cost(model, 1_000, 1_000, 0)
        large = advisor.estimate_cost(model, 1_000_000, 1_000, 0)  # 1000 млн токенов → 4 блока
        assert (small.units, small.total_rub) == (1, 70_000)
        assert (large.units, large.total_rub) == (4, 280_000)

    def test_overhead_multiplies_token_volume(self, advisor):
        model = advisor.catalog.get("gigachat-2-lite")
        base = advisor.estimate_cost(model, 1_000, 1_000, 100)
        padded = advisor.estimate_cost(model, 1_000, 1_000, 100, overhead=1.5)
        assert padded.variable_rub == pytest.approx(base.variable_rub * 1.5, rel=1e-3)


class TestConstraints:
    def test_personal_data_excludes_foreign_clouds_with_policy_reason(self, advisor):
        result = advisor.recommend(
            workload(data_sensitivity=Sensitivity.PERSONAL, allow_workarounds=True)
        )
        assert result.recommendations
        assert all(r.deployment is not Deployment.FOREIGN_CLOUD for r in result.recommendations)
        foreign = [e for e in result.excluded if e.deployment is Deployment.FOREIGN_CLOUD]
        assert foreign
        assert all("policy" in e.kinds and "Политика данных" in e.reasons[0] for e in foreign)

    def test_ru_cloud_for_personal_data_requires_masking(self, advisor):
        result = advisor.recommend(workload(data_sensitivity=Sensitivity.PERSONAL), top=20)
        by_deployment = {r.deployment: r for r in result.recommendations}
        assert by_deployment[Deployment.RU_CLOUD].requires_masking
        assert not by_deployment[Deployment.SELF_HOSTED].requires_masking

    def test_foreign_models_need_explicit_permission_to_use_workarounds(self, advisor):
        strict = advisor.recommend(workload(data_sensitivity=Sensitivity.PUBLIC), top=20)
        relaxed = advisor.recommend(
            workload(data_sensitivity=Sensitivity.PUBLIC, allow_workarounds=True), top=20
        )
        assert all(r.ru_access is RuAccess.DIRECT for r in strict.recommendations)
        assert any(r.ru_access is RuAccess.WORKAROUND for r in relaxed.recommendations)

    def test_foreign_cloud_can_be_forbidden_even_with_workarounds(self, advisor):
        result = advisor.recommend(
            workload(
                data_sensitivity=Sensitivity.PUBLIC,
                allow_workarounds=True,
                allow_foreign_cloud=False,
            ),
            top=20,
        )
        assert all(r.deployment is not Deployment.FOREIGN_CLOUD for r in result.recommendations)

    def test_must_self_host_leaves_only_self_hosted_models(self, advisor):
        result = advisor.recommend(workload(must_self_host=True), top=20)
        assert {r.deployment for r in result.recommendations} == {Deployment.SELF_HOSTED}

    def test_budget_excludes_expensive_models_with_reason(self, advisor):
        result = advisor.recommend(workload(monthly_budget_rub=5_000), top=20)
        assert all(r.cost.total_rub <= 5_000 for r in result.recommendations)
        budget = [e for e in result.excluded if "budget" in e.kinds]
        assert budget
        assert "превышает бюджет" in budget[0].reasons[-1]

    @pytest.mark.parametrize(
        ("field", "value", "kind"),
        [
            ("needs_vision", True, "vision"),
            ("min_context_tokens", 150_000, "context"),
        ],
    )
    def test_capability_requirements_filter_models(self, advisor, field, value, kind):
        result = advisor.recommend(workload(allow_workarounds=True, **{field: value}), top=20)
        excluded_by_kind = {e.model_id for e in result.excluded if kind in e.kinds}
        assert excluded_by_kind
        assert not excluded_by_kind & {r.model_id for r in result.recommendations}

    def test_tool_calling_requirement_excludes_models_without_tools(self, advisor):
        catalog = advisor.catalog.model_copy(deep=True)
        catalog.models[0] = catalog.models[0].model_copy(update={"tool_calling": False})
        strict = Advisor(catalog, advisor.policy, usd_rub=90.0, today=TODAY)
        result = strict.recommend(workload(needs_tool_calling=True), top=20)
        assert {e.model_id for e in result.excluded if "tools" in e.kinds} == {catalog.models[0].id}

    def test_quality_threshold_excludes_weaker_models(self, advisor):
        result = advisor.recommend(workload(task_type=TaskType.CODE, min_quality=4), top=20)
        ids = {r.model_id for r in result.recommendations}
        assert "gigachat-2-lite" not in ids
        assert all(r.quality >= 4 for r in result.recommendations)

    def test_impossible_requirements_yield_actionable_relaxation_hints(self, advisor):
        result = advisor.recommend(
            workload(
                task_type=TaskType.DECISION_SUPPORT,
                data_sensitivity=Sensitivity.PERSONAL,
                min_quality=5,
            )
        )
        assert result.recommendations == []
        joined = " ".join(result.notes)
        assert "Подходящих моделей нет" in joined
        assert "Снизьте требуемое качество" in joined
        assert "ослабьте политику" not in joined.lower()  # политику данных ослаблять не советуем

    def test_no_hint_ever_suggests_relaxing_data_policy(self, advisor):
        result = advisor.recommend(workload(data_sensitivity=Sensitivity.PERSONAL, min_quality=5))
        assert not any("политик" in note.lower() and "подойдут" in note for note in result.notes)


class TestRanking:
    def test_ranks_are_consecutive_and_sorted_by_score(self, advisor):
        result = advisor.recommend(workload(), top=20)
        assert [r.rank for r in result.recommendations] == list(
            range(1, len(result.recommendations) + 1)
        )
        scores = [r.score for r in result.recommendations]
        assert scores == sorted(scores, reverse=True)

    def test_cost_preference_picks_cheapest_and_quality_preference_picks_best(self, advisor):
        cheap = advisor.recommend(workload(prefer=Preference.COST, min_quality=1), top=20)
        best = advisor.recommend(
            workload(prefer=Preference.QUALITY, task_type=TaskType.DRAFTING, min_quality=1), top=20
        )
        assert cheap.recommendations[0].cost.total_rub == min(
            r.cost.total_rub for r in cheap.recommendations
        )
        assert best.recommendations[0].quality == max(r.quality for r in best.recommendations)

    def test_good_enough_quality_beats_overpaying_for_surplus(self, advisor):
        """Для порога 3/5 дешёвая модель с оценкой 3 обгоняет втрое более дорогую с оценкой 4."""
        result = advisor.recommend(
            workload(must_self_host=True, data_sensitivity=Sensitivity.PERSONAL), top=5
        )
        assert result.recommendations[0].model_id == "qwen-small-selfhost"

    def test_ranking_is_deterministic(self, advisor):
        first = advisor.recommend(workload(), top=20).model_dump()
        second = advisor.recommend(workload(), top=20).model_dump()
        assert first == second

    def test_every_recommendation_explains_itself(self, advisor):
        for rec in advisor.recommend(
            workload(data_sensitivity=Sensitivity.PERSONAL), top=20
        ).recommendations:
            assert rec.pros
            assert any("качества" in p for p in rec.pros)

    def test_notes_warn_about_illustrative_and_stale_catalog(self):
        late = Advisor(load_catalog(), Policy.load(), today=TODAY + timedelta(days=200))
        notes = " ".join(late.recommend(workload()).notes)
        assert "экспертн" in notes
        assert "не проверялись" in notes


@settings(max_examples=60, deadline=None)
@given(
    task=st.sampled_from(list(TaskType)),
    sensitivity=st.sampled_from(list(Sensitivity)),
    requests=st.integers(1, 5_000_000),
    tokens_in=st.integers(1, 100_000),
    tokens_out=st.integers(0, 20_000),
    min_quality=st.integers(1, 5),
    prefer=st.sampled_from(list(Preference)),
    workarounds=st.booleans(),
)
def test_advice_invariants_hold_for_any_workload(
    task, sensitivity, requests, tokens_in, tokens_out, min_quality, prefer, workarounds
):
    advisor = Advisor(load_catalog(), Policy.load(), today=TODAY)
    result = advisor.recommend(
        Workload(
            task_type=task,
            data_sensitivity=sensitivity,
            requests_per_month=requests,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            min_quality=min_quality,
            prefer=prefer,
            allow_workarounds=workarounds,
        ),
        top=20,
    )
    total = len(advisor.catalog.models)
    assert len(result.recommendations) + len(result.excluded) == total
    for rec in result.recommendations:
        assert 0 <= rec.score <= 100
        assert rec.quality >= min_quality
        assert rec.cost.total_rub >= 0
        if sensitivity in (Sensitivity.CONFIDENTIAL, Sensitivity.PERSONAL):
            assert rec.deployment is not Deployment.FOREIGN_CLOUD
