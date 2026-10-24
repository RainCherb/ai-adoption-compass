from datetime import date, timedelta

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from pydantic import ValidationError

from adoption_compass.advisor import Advisor
from adoption_compass.assessment import AssessmentEngine, Process
from adoption_compass.catalog import load_catalog
from adoption_compass.csv_io import parse_processes_csv
from adoption_compass.domain import Deployment, Quadrant, Sensitivity, Severity, TaskType
from adoption_compass.resources import read_data_text
from adoption_compass.safety import Policy
from adoption_compass.scoring import load_scoring

TODAY = date(2026, 10, 24)
RECOMMENDED = {Quadrant.QUICK_WIN, Quadrant.STRATEGIC, Quadrant.FILL_IN}


@pytest.fixture(scope="module")
def engine() -> AssessmentEngine:
    return AssessmentEngine(load_scoring(), Advisor(load_catalog(), Policy.load(), today=TODAY))


def proc(**overrides) -> Process:
    base = {
        "id": "X1",
        "name": "Тестовый процесс",
        "task_type": "classification",
        "runs_per_month": 1000,
        "minutes_per_run": 6,
        "hourly_cost_rub": 1000,
        "error_rate": 0,
        "error_cost_rub": 0,
        "standardization": 5,
        "digital_readiness": 5,
        "risk_level": 1,
        "data_sensitivity": "public",
    }
    return Process.model_validate({**base, **overrides})


class TestEconomics:
    def test_numbers_follow_the_documented_formulas(self, engine):
        result = engine.assess([proc()], {"llm_overhead": 1.0}).processes[0]
        assert result.hours_per_month == 100.0
        assert result.automation_share == pytest.approx(0.70)  # база × 1.0 × 1.0
        assert result.net_share == pytest.approx(0.63)  # минус 10% на проверку
        assert result.hours_saved_month == pytest.approx(63.0)
        assert result.savings_month_rub == pytest.approx(63_000)
        assert result.implementation_days == 6.0
        assert result.implementation_rub == pytest.approx(150_000)
        assert result.support_month_rub == pytest.approx(3_000)  # 2% в месяц
        net_month = 63_000 - result.llm_cost_month_rub - 3_000
        assert result.net_month_rub == pytest.approx(net_month, abs=0.01)
        assert result.payback_months == pytest.approx(150_000 / net_month, abs=0.01)
        assert result.net_horizon_rub == pytest.approx(net_month * 12 - 150_000, abs=0.5)

    def test_error_reduction_adds_to_benefit(self, engine):
        base = engine.assess([proc()]).processes[0]
        with_errors = engine.assess(
            [proc(error_rate=0.1, error_cost_rub=1000)], {"error_reduction": 0.5}
        ).processes[0]
        assert with_errors.error_savings_month_rub == pytest.approx(1000 * 0.1 * 1000 * 0.5)
        assert with_errors.net_month_rub > base.net_month_rub

    def test_scenarios_are_ordered_and_base_matches_headline(self, engine):
        result = engine.assess([proc()]).processes[0]
        by_key = {s.key: s for s in result.scenarios}
        assert (
            by_key["pessimistic"].net_horizon_rub
            < by_key["base"].net_horizon_rub
            < by_key["optimistic"].net_horizon_rub
        )
        assert by_key["base"].net_horizon_rub == result.net_horizon_rub
        assert by_key["base"].payback_months == result.payback_months

    def test_risk_and_sensitivity_make_implementation_harder(self, engine):
        easy = engine.assess([proc()]).processes[0]
        hard = engine.assess(
            [proc(risk_level=5, digital_readiness=1, data_sensitivity="personal")]
        ).processes[0]
        assert hard.implementation_days > easy.implementation_days
        assert hard.ease < easy.ease

    def test_tiny_process_is_postponed_with_explanation(self, engine):
        result = engine.assess([proc(runs_per_month=10, minutes_per_run=5)]).processes[0]
        codes = {f.code for f in result.flags}
        assert result.quadrant is Quadrant.POSTPONE
        assert result.wave is None
        assert {"negative_roi", "low_volume"} <= codes
        assert result.payback_months is None or result.payback_months > 12

    def test_assumption_overrides_change_the_result(self, engine):
        short = engine.assess([proc()], {"horizon_months": 6}).processes[0]
        long = engine.assess([proc()], {"horizon_months": 36}).processes[0]
        assert long.net_horizon_rub > short.net_horizon_rub
        assert engine.assess([proc()], {"horizon_months": 6}).assumptions.horizon_months == 6

    def test_invalid_override_is_rejected(self, engine):
        with pytest.raises(ValidationError):
            engine.assess([proc()], {"horizon_months": 0})


class TestBlockedAndFlags:
    def test_high_risk_decision_on_personal_data_has_no_compliant_model(self, engine):
        result = engine.assess(
            [proc(task_type="decision_support", risk_level=5, data_sensitivity="personal")]
        ).processes[0]
        codes = {f.code: f.severity for f in result.flags}
        assert result.quadrant is Quadrant.BLOCKED
        assert not result.feasible
        assert result.priority == 0
        assert result.model is None
        assert result.wave is None
        assert codes["no_compliant_model"] is Severity.CRITICAL
        assert codes["automated_decision"] is Severity.CRITICAL
        assert "human_in_the_loop" in codes

    def test_blocked_process_is_excluded_from_totals_and_roadmap(self, engine):
        ok, blocked = (
            proc(id="OK"),
            proc(id="BAD", task_type="decision_support", risk_level=5, data_sensitivity="personal"),
        )
        result = engine.assess([ok, blocked])
        assert result.summary.processes_blocked == 1
        assert all("BAD" not in wave.process_ids for wave in result.roadmap)
        only_ok = engine.assess([ok])
        assert result.summary.net_horizon_rub == pytest.approx(only_ok.summary.net_horizon_rub)

    def test_personal_data_flags_masking_for_russian_cloud(self, engine):
        result = engine.assess([proc(data_sensitivity="personal")]).processes[0]
        codes = {f.code for f in result.flags}
        assert "personal_data" in codes
        assert result.model is not None
        if result.model.deployment is Deployment.RU_CLOUD:
            assert "needs_masking" in codes

    def test_low_digital_readiness_is_warned(self, engine):
        result = engine.assess([proc(digital_readiness=1)]).processes[0]
        assert any(f.code == "low_digital_readiness" for f in result.flags)


@pytest.fixture(scope="module")
def demo(engine):
    parsed = parse_processes_csv(read_data_text("samples/processes.csv"))
    assert parsed.errors == []
    return engine.assess(parsed.processes)


class TestPortfolio:
    def test_demo_portfolio_shows_every_quadrant(self, demo):
        assert {p.quadrant for p in demo.processes} == set(Quadrant)

    def test_processes_are_ranked_by_priority(self, demo):
        assert [p.rank for p in demo.processes] == list(range(1, len(demo.processes) + 1))
        priorities = [p.priority for p in demo.processes]
        assert priorities == sorted(priorities, reverse=True)

    def test_roadmap_partitions_recommended_processes(self, demo):
        recommended = {p.id for p in demo.processes if p.quadrant in RECOMMENDED}
        in_roadmap = [pid for wave in demo.roadmap for pid in wave.process_ids]
        assert set(in_roadmap) == recommended
        assert len(in_roadmap) == len(recommended)
        assert [w.wave for w in demo.roadmap] == sorted(w.wave for w in demo.roadmap)

    def test_summary_is_the_sum_of_recommended_processes(self, demo):
        recommended = [p for p in demo.processes if p.quadrant in RECOMMENDED]
        s = demo.summary
        assert s.recommended_count == len(recommended)
        assert s.hours_saved_month == pytest.approx(
            sum(p.hours_saved_month for p in recommended), abs=0.2
        )
        assert s.implementation_rub == pytest.approx(sum(p.implementation_rub for p in recommended))
        assert sum(s.quadrant_counts.values()) == s.processes_total == 18
        expected_net = sum(p.net_horizon_rub for p in recommended)
        assert s.net_horizon_rub == pytest.approx(expected_net, rel=1e-3)

    def test_shared_server_cost_is_split_by_token_volume(self, demo):
        line = next(i for i in demo.summary.infrastructure if i.process_ids)
        members = [p for p in demo.processes if p.id in line.process_ids]
        assert len(members) >= 2
        shares = [p.model.cost.fixed_rub for p in members if p.model]
        assert sum(shares) == pytest.approx(line.fixed_rub_month, abs=0.05 * len(shares))

    def test_stale_catalog_adds_warning(self):
        late = AssessmentEngine(
            load_scoring(),
            Advisor(load_catalog(), Policy.load(), today=TODAY + timedelta(days=365)),
        )
        warnings = " ".join(late.assess([proc()]).warnings)
        assert "экспертн" in warnings
        assert "90 дней" in warnings

    def test_duplicate_and_empty_inputs_are_rejected(self, engine):
        with pytest.raises(ValueError, match="Повторяющиеся"):
            engine.assess([proc(), proc()])
        with pytest.raises(ValueError, match="пуст"):
            engine.assess([])


class TestSharedInfrastructure:
    @staticmethod
    def pair():
        big = proc(
            id="A",
            runs_per_month=9500,
            minutes_per_run=3,
            hourly_cost_rub=700,
            standardization=4,
            data_sensitivity="personal",
            must_self_host=True,
        )
        # Много токенов, но мало пользы: на общем сервере он «съедает» долю A.
        small = proc(
            id="B",
            runs_per_month=2000,
            minutes_per_run=1,
            hourly_cost_rub=500,
            standardization=3,
            tokens_in=3000,
            data_sensitivity="personal",
            must_self_host=True,
        )
        return big, small

    def test_unprofitable_process_stops_sharing_the_server(self, engine):
        big, small = self.pair()
        result = engine.assess([big, small])
        a = next(p for p in result.processes if p.id == "A")
        b = next(p for p in result.processes if p.id == "B")
        assert a.model
        assert b.model
        assert a.model.model_id == b.model.model_id == "qwen-small-selfhost"
        assert b.quadrant is Quadrant.POSTPONE
        assert a.quadrant in RECOMMENDED
        (line,) = result.summary.infrastructure
        assert line.process_ids == ["A"]
        assert line.fixed_rub_month == pytest.approx(70_000)
        assert a.model.cost.fixed_rub == pytest.approx(70_000)  # A несёт сервер целиком

    def test_without_sharing_every_process_pays_for_its_own_server(self, engine):
        big, small = self.pair()
        result = engine.assess([big, small], {"share_infrastructure": False})
        by_id = {p.id: p for p in result.processes}
        assert by_id["A"].model
        assert by_id["B"].model
        assert by_id["A"].model.cost.fixed_rub == pytest.approx(70_000)
        assert by_id["B"].model.cost.fixed_rub == pytest.approx(70_000)

    def test_both_processes_share_when_both_are_profitable(self, engine):
        big, _ = self.pair()
        twin = big.model_copy(update={"id": "A2"})
        result = engine.assess([big, twin])
        (line,) = result.summary.infrastructure
        assert sorted(line.process_ids) == ["A", "A2"]
        fixed = [p.model.cost.fixed_rub for p in result.processes if p.model]
        assert fixed == pytest.approx([35_000, 35_000])


process_strategy = st.builds(
    Process,
    id=st.integers(0, 10_000).map(lambda i: f"P{i}"),
    name=st.just("Процесс"),
    task_type=st.sampled_from(list(TaskType)),
    runs_per_month=st.integers(1, 200_000),
    minutes_per_run=st.floats(0.1, 600, allow_nan=False),
    hourly_cost_rub=st.floats(100, 5_000, allow_nan=False),
    error_rate=st.floats(0, 1, allow_nan=False),
    error_cost_rub=st.floats(0, 100_000, allow_nan=False),
    standardization=st.integers(1, 5),
    digital_readiness=st.integers(1, 5),
    risk_level=st.integers(1, 5),
    data_sensitivity=st.sampled_from(list(Sensitivity)),
    must_self_host=st.booleans(),
)


@settings(max_examples=40, deadline=None)
@given(st.lists(process_strategy, min_size=1, max_size=6, unique_by=lambda p: p.id))
def test_portfolio_invariants_hold_for_arbitrary_processes(processes):
    engine = AssessmentEngine(load_scoring(), Advisor(load_catalog(), Policy.load(), today=TODAY))
    result = engine.assess(processes)
    assert [p.rank for p in result.processes] == list(range(1, len(processes) + 1))
    assert sum(result.summary.quadrant_counts.values()) == len(processes)
    for p in result.processes:
        assert 0 <= p.fit <= 100
        assert 0 <= p.impact <= 100
        assert 0 <= p.ease <= 100
        assert 0 <= p.priority <= 100
        assert p.payback_months is None or p.payback_months > 0
        if p.quadrant is Quadrant.BLOCKED:
            assert p.priority == 0
            assert p.model is None
            assert p.wave is None
        else:
            assert p.model is not None
        assert (p.wave is not None) == (p.quadrant in RECOMMENDED)
    in_roadmap = [pid for wave in result.roadmap for pid in wave.process_ids]
    assert len(in_roadmap) == len(set(in_roadmap)) == result.summary.recommended_count
