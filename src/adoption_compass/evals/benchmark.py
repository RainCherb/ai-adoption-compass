"""Проверяемый артефакт настоящего прогона: те же примеры, промпты и полные ответы."""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from ..resources import read_data_text
from .metrics import compute_metrics
from .providers import Completion, KeywordBaselineProvider, OpenAICompatibleProvider, ProviderError
from .runner import EvalReport, reports_markdown, run_eval, with_baseline_lift
from .task import EvalItem, EvalTask, load_items, load_task


class Observation(BaseModel):
    item_id: str
    expected: str
    predicted: str | None
    raw_response: str | None
    latency_ms: float | None
    tokens_in: int = 0
    tokens_out: int = 0
    error: str | None = None


class BenchmarkRun(BaseModel):
    provider: str
    model_source: str
    revision: str = Field(pattern=r"^[0-9a-f]{40}$")
    weights_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    quantization: str
    parameters: dict[str, Any]
    observations: list[Observation]


class BenchmarkArtifact(BaseModel):
    version: Literal[1] = 1
    kind: Literal["measured"] = "measured"
    created_at: datetime
    task_id: str
    dataset_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    prompt_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    runtime: dict[str, Any]
    external_spend_rub: Literal[0] = 0
    limitations: list[str]
    runs: list[BenchmarkRun]
    reports: list[EvalReport]
    markdown: str


class RecordingProvider:
    is_baseline = False

    def __init__(self, inner: OpenAICompatibleProvider, task: EvalTask, items: list[EvalItem]):
        self.inner, self.task, self.items = inner, task, items
        self.name, self.pricing = inner.name, inner.pricing
        self.observations: list[Observation] = []

    def complete(self, system: str, user: str) -> Completion:
        item = self.items[len(self.observations)]
        try:
            completion = self.inner.complete(system, user)
        except ProviderError as exc:
            self.observations.append(
                Observation(
                    item_id=item.id,
                    expected=item.label,
                    predicted=None,
                    raw_response=None,
                    latency_ms=None,
                    error=str(exc),
                )
            )
            raise
        self.observations.append(
            Observation(
                item_id=item.id,
                expected=item.label,
                predicted=self.task.extract_label(completion.text),
                raw_response=completion.text,
                latency_ms=completion.latency_ms,
                tokens_in=completion.tokens_in,
                tokens_out=completion.tokens_out,
            )
        )
        return completion


def fingerprint(task: EvalTask) -> str:
    return hashlib.sha256(
        json.dumps(
            {"system": task.system_prompt(), "user_template": task.user_prompt("{text}")},
            ensure_ascii=False,
            sort_keys=True,
        ).encode()
    ).hexdigest()


def make_artifact(
    runs: list[BenchmarkRun], reports: list[EvalReport], runtime: dict[str, Any]
) -> BenchmarkArtifact:
    task, items = load_task(), load_items(load_task())
    reports = with_baseline_lift([run_eval(KeywordBaselineProvider(task), task, items), *reports])
    return BenchmarkArtifact(
        created_at=datetime.now(UTC),
        task_id=task.id,
        dataset_sha256=hashlib.sha256(read_data_text("evals/routing.jsonl").encode()).hexdigest(),
        prompt_sha256=fingerprint(task),
        runtime=runtime,
        limitations=[
            "72 синтетических обращения на русском, 8 классов; один фиксированный набор, не независимый production benchmark.",
            "Три компактные модели Q8_0 на CPU, один прогон, temperature=0, max_tokens=64; Qwen3 без thinking.",
            "Задержки относятся только к указанной машине и включают HTTP; baseline имеет условную задержку 1 мс.",
            "API-счёт равен 0 ₽. Электроэнергия, оборудование и стоимость владения не измерялись; cost_rub=null.",
            "Эти результаты не переносятся на другие модели семейства и не заменяют экспертные оценки каталога.",
        ],
        runs=runs,
        reports=reports,
        markdown=reports_markdown(reports, task),
    )


def load_benchmark(data_dir: Path | None = None) -> BenchmarkArtifact:
    artifact = BenchmarkArtifact.model_validate_json(
        read_data_text("evals/measured.json", data_dir)
    )
    task = load_task(data_dir)
    dataset = read_data_text("evals/routing.jsonl", data_dir)
    if artifact.dataset_sha256 != hashlib.sha256(
        dataset.encode()
    ).hexdigest() or artifact.prompt_sha256 != fingerprint(task):
        raise ValueError("Набор данных или промпт изменились после замера; требуется новый прогон")
    items = load_items(task, data_dir)
    expected_providers = {"baseline:keywords", *(run.provider for run in artifact.runs)}
    if {report.provider for report in artifact.reports} != expected_providers or len(
        artifact.reports
    ) != len(expected_providers):
        raise ValueError("Набор отчётов не соответствует измеренным провайдерам")
    if len({run.provider for run in artifact.runs}) != len(artifact.runs):
        raise ValueError("Повторяющийся провайдер")
    for run in artifact.runs:
        if len(run.observations) != len(items):
            raise ValueError("Неполный журнал измерений")
        for observation, item in zip(run.observations, items, strict=True):
            if (observation.item_id, observation.expected) != (item.id, item.label):
                raise ValueError("Изменились порядок или метки примеров")
            if observation.predicted != task.extract_label(observation.raw_response or ""):
                raise ValueError("Предсказание не соответствует сохранённому ответу")
        report = next((r for r in artifact.reports if r.provider == run.provider), None)
        metrics = compute_metrics(
            task.label_names, [i.label for i in items], [o.predicted for o in run.observations]
        )
        if (
            report is None
            or report.metrics != metrics
            or report.n != len(items)
            or report.task_id != task.id
        ):
            raise ValueError("Метрики не соответствуют журналу ответов")
    return artifact
