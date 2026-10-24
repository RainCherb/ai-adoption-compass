import json

import httpx
import pytest

from adoption_compass.evals import (
    SIM_PROFILES,
    Completion,
    KeywordBaselineProvider,
    OpenAICompatibleProvider,
    Pricing,
    ProviderError,
    SimulatedProvider,
    compute_metrics,
    load_items,
    load_task,
    parse_items,
    percentile,
    reports_markdown,
    run_demo,
    run_eval,
)


@pytest.fixture(scope="module")
def task():
    return load_task()


@pytest.fixture(scope="module")
def items(task):
    return load_items(task)


class TestMetrics:
    def test_confusion_matrix_and_scores_match_hand_calculation(self):
        labels = ["a", "b", "c"]
        expected = ["a", "a", "b", "b", "c", "c"]
        predicted = ["a", "b", "b", "b", None, "a"]
        m = compute_metrics(labels, expected, predicted)
        assert m.confusion == [[1, 1, 0], [0, 2, 0], [1, 0, 0]]
        assert (m.n, m.invalid, m.accuracy) == (6, 1, 0.5)
        stats = {s.label: s for s in m.per_class}
        assert (stats["a"].precision, stats["a"].recall, stats["a"].f1) == (0.5, 0.5, 0.5)
        assert (stats["b"].precision, stats["b"].recall) == (0.6667, 1.0)
        assert stats["b"].f1 == 0.8
        assert (stats["c"].precision, stats["c"].recall, stats["c"].f1) == (0.0, 0.0, 0.0)
        assert m.macro_f1 == pytest.approx(0.4333, abs=1e-4)

    def test_perfect_predictions(self):
        m = compute_metrics(["x", "y"], ["x", "y", "x"], ["x", "y", "x"])
        assert m.accuracy == 1.0
        assert m.macro_f1 == 1.0
        assert m.invalid == 0

    def test_length_mismatch_is_rejected(self):
        with pytest.raises(ValueError, match="одной длины"):
            compute_metrics(["a"], ["a"], [])

    @pytest.mark.parametrize(("q", "expected"), [(50, 3), (95, 5), (100, 5), (1, 1), (0, 1)])
    def test_percentile_uses_nearest_rank(self, q, expected):
        assert percentile([5, 1, 4, 2, 3], q) == expected
        assert percentile([], 50) == 0.0


class TestTask:
    def test_dataset_is_balanced_and_valid(self, task, items):
        assert len(items) == 72
        counts = {label: sum(1 for i in items if i.label == label) for label in task.label_names}
        assert set(counts.values()) == {9}
        assert len({i.id for i in items}) == 72

    def test_prompts_list_every_label_and_demand_json(self, task):
        system = task.system_prompt()
        assert all(name in system for name in task.label_names)
        assert '"label"' in system
        assert task.fallback_label in system
        assert "<ticket>" in task.user_prompt("текст")

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [
            ('{"label": "billing"}', "billing"),
            ('Ответ: {"label": "returns"} спасибо', "returns"),
            ('{"label": "выдумка"} но это billing', "billing"),
            ("Категория: Delivery", "delivery"),
            ("billing или returns", None),
            ("не знаю", None),
            ('{"label": 5}', None),
        ],
    )
    def test_label_extraction_is_forgiving_but_unambiguous(self, task, raw, expected):
        assert task.extract_label(raw) == expected

    def test_parse_items_validates_input(self, task):
        assert len(parse_items('{"id":"1","text":"т","label":"billing"}\n\n', task)) == 1
        with pytest.raises(ValueError, match="неизвестная категория"):
            parse_items('{"id":"1","text":"т","label":"magic"}', task)
        with pytest.raises(ValueError, match="Строка 1"):
            parse_items("не json", task)
        with pytest.raises(ValueError, match="пуст"):
            parse_items("\n", task)


class TestProviders:
    def test_baseline_beats_chance_by_a_wide_margin(self, task, items):
        report = run_eval(KeywordBaselineProvider(task), task, items)
        assert report.metrics.accuracy > 0.6
        assert report.is_baseline
        assert report.cost_rub == 0

    def test_baseline_falls_back_when_no_keyword_matches(self, task):
        provider = KeywordBaselineProvider(task)
        answer = provider.complete(task.system_prompt(), task.user_prompt("qwerty zzz")).text
        assert task.extract_label(answer) == task.fallback_label

    def test_simulation_is_deterministic_and_ordered_by_quality(self, task, items):
        def accuracy(name: str) -> float:
            return run_eval(SimulatedProvider(name, task, items), task, items).metrics.accuracy

        first = {name: accuracy(name) for name in SIM_PROFILES}
        assert first == {name: accuracy(name) for name in SIM_PROFILES}
        assert first["flagship"] >= first["balanced"] >= first["economy"]
        assert first["flagship"] >= 0.9
        assert first["economy"] <= 0.9

    def test_unknown_simulation_profile_is_rejected(self, task, items):
        with pytest.raises(ValueError, match="Неизвестный профиль"):
            SimulatedProvider("genius", task, items)


class FixedProvider:
    name = "fixed"
    is_baseline = False

    def __init__(self, answer: str, pricing: Pricing | None) -> None:
        self.answer, self.pricing = answer, pricing

    def complete(self, system: str, user: str) -> Completion:
        return Completion(self.answer, latency_ms=100.0, tokens_in=1_000, tokens_out=10)


class BrokenProvider:
    name = "broken"
    is_baseline = False
    pricing = None

    def complete(self, system: str, user: str) -> Completion:
        raise ProviderError("HTTP 500")


class TestRunner:
    def test_cost_is_computed_from_tokens_and_prices(self, task, items):
        subset = items[:10]
        report = run_eval(
            FixedProvider('{"label": "billing"}', Pricing(1_000, 2_000)), task, subset
        )
        assert report.tokens_in == 10_000
        assert report.tokens_out == 100
        assert report.cost_rub == pytest.approx((10_000 * 1_000 + 100 * 2_000) / 1e6)
        assert report.cost_per_1k_rub == pytest.approx(report.cost_rub / 10 * 1000)
        correct = round(report.metrics.accuracy * 10)
        assert report.cost_per_correct_rub == pytest.approx(report.cost_rub / correct, rel=1e-3)

    def test_unpriced_provider_reports_no_cost(self, task, items):
        report = run_eval(FixedProvider('{"label": "billing"}', None), task, items[:5])
        assert report.cost_rub is None
        assert report.cost_per_1k_rub is None

    def test_provider_errors_are_counted_and_do_not_stop_the_run(self, task, items):
        report = run_eval(BrokenProvider(), task, items[:6])
        assert report.errors == 6
        assert report.metrics.invalid == 6
        assert report.metrics.accuracy == 0
        assert report.latency.mean_ms == 0

    def test_failures_are_capped_and_describe_the_miss(self, task, items):
        report = run_eval(FixedProvider('{"label": "other"}', None), task, items, max_failures=3)
        assert len(report.failures) == 3
        assert report.failures[0].got == "other"
        assert report.failures[0].expected != "other"

    def test_demo_compares_baseline_and_three_simulations(self, task, items):
        reports = run_demo(task, items)
        assert [r.provider for r in reports] == [
            "baseline:keywords",
            "sim:economy",
            "sim:balanced",
            "sim:flagship",
        ]
        baseline = reports[0]
        assert baseline.accuracy_lift == 0
        for report in reports[1:]:
            assert report.accuracy_lift == pytest.approx(
                report.metrics.accuracy - baseline.metrics.accuracy, abs=1e-4
            )

    def test_markdown_report_has_table_and_simulation_disclaimer(self, task, items):
        text = reports_markdown(run_demo(task, items), task)
        assert text.startswith("# Оценка качества")
        assert "| sim:flagship |" in text
        assert "детерминированный симулятор" in text


def make_provider(handler, *, api_key="test-key", **kwargs) -> OpenAICompatibleProvider:
    return OpenAICompatibleProvider(
        "https://api.test/v1",
        "demo-model",
        api_key,
        transport=httpx.MockTransport(handler),
        sleep=kwargs.pop("sleep", lambda _s: None),
        **kwargs,
    )


def ok(content='{"label": "billing"}', usage=True):
    body = {"choices": [{"message": {"content": content}}]}
    if usage:
        body["usage"] = {"prompt_tokens": 120, "completion_tokens": 7}
    return httpx.Response(200, json=body)


class TestOpenAICompatibleProvider:
    def test_sends_chat_completion_request_and_reads_usage(self):
        seen = {}

        def handler(request: httpx.Request) -> httpx.Response:
            seen["url"] = str(request.url)
            seen["auth"] = request.headers.get("authorization")
            seen["body"] = json.loads(request.content)
            return ok()

        completion = make_provider(handler).complete("система", "пользователь")
        assert seen["url"] == "https://api.test/v1/chat/completions"
        assert seen["auth"] == "Bearer test-key"
        assert seen["body"]["model"] == "demo-model"
        assert seen["body"]["temperature"] == 0
        assert [m["role"] for m in seen["body"]["messages"]] == ["system", "user"]
        assert completion.text == '{"label": "billing"}'
        assert (completion.tokens_in, completion.tokens_out) == (120, 7)
        assert completion.latency_ms >= 0

    def test_without_key_no_authorization_header_is_sent(self):
        def handler(request: httpx.Request) -> httpx.Response:
            assert "authorization" not in request.headers
            return ok()

        make_provider(handler, api_key=None).complete("s", "u")

    def test_missing_usage_falls_back_to_estimates(self):
        completion = make_provider(lambda r: ok(usage=False)).complete("система", "пользователь")
        assert completion.tokens_in > 0
        assert completion.tokens_out > 0

    def test_retries_rate_limits_with_backoff_then_succeeds(self):
        calls, sleeps = [], []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(1)
            return httpx.Response(429) if len(calls) == 1 else ok()

        completion = make_provider(handler, sleep=sleeps.append).complete("s", "u")
        assert completion.text
        assert len(calls) == 2
        assert sleeps == [0.5]

    def test_gives_up_after_max_retries(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(1)
            return httpx.Response(503)

        with pytest.raises(ProviderError, match="HTTP 503"):
            make_provider(handler, max_retries=2).complete("s", "u")
        assert len(calls) == 3

    def test_client_errors_are_not_retried(self):
        calls = []

        def handler(request: httpx.Request) -> httpx.Response:
            calls.append(1)
            return httpx.Response(401)

        with pytest.raises(ProviderError, match="HTTP 401"):
            make_provider(handler).complete("s", "u")
        assert len(calls) == 1

    def test_malformed_response_is_a_provider_error(self):
        with pytest.raises(ProviderError, match="формат"):
            make_provider(lambda r: httpx.Response(200, json={"oops": 1})).complete("s", "u")

    def test_network_failures_are_wrapped(self):
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("boom")

        with pytest.raises(ProviderError, match="сетевая ошибка"):
            make_provider(handler, max_retries=1).complete("s", "u")

    def test_full_evaluation_through_the_http_client(self, task, items):
        provider = make_provider(lambda r: ok('{"label": "billing"}'), pricing=Pricing(100, 100))
        report = run_eval(provider, task, items)
        assert report.metrics.accuracy == pytest.approx(9 / 72, abs=1e-4)
        assert report.tokens_in == 120 * 72
        assert report.cost_rub is not None
