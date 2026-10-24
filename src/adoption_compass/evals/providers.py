"""Провайдеры для оценки: keyword-baseline, детерминированный симулятор, OpenAI-совместимый API."""

import hashlib
import random
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

import httpx

from .task import EvalItem, EvalTask


class ProviderError(RuntimeError):
    """Провайдер не вернул пригодный ответ (после повторов)."""


@dataclass(frozen=True)
class Completion:
    text: str
    latency_ms: float
    tokens_in: int
    tokens_out: int


@dataclass(frozen=True)
class Pricing:
    """Цена за 1 млн токенов в рублях."""

    input_per_mtok_rub: float
    output_per_mtok_rub: float


class Provider(Protocol):
    name: str
    is_baseline: bool
    pricing: Pricing | None

    def complete(self, system: str, user: str) -> Completion: ...


def estimate_tokens(text: str) -> int:
    """Грубая оценка для русского текста: около трёх символов на токен."""
    return max(1, round(len(text) / 3.0))


class KeywordBaselineProvider:
    """Классификатор на правилах: нижняя граница качества, которую LLM должна превзойти."""

    is_baseline = True

    def __init__(self, task: EvalTask) -> None:
        self.name = "baseline:keywords"
        self.pricing: Pricing | None = Pricing(0.0, 0.0)
        self._task = task

    def complete(self, system: str, user: str) -> Completion:
        match = re.search(r"<ticket>\n?(.*?)\n?</ticket>", user, re.DOTALL)
        text = (match.group(1) if match else user).lower()
        best, best_hits = self._task.fallback_label, 0
        for name, spec in self._task.labels.items():
            hits = sum(1 for keyword in spec.keywords if keyword in text)
            if hits > best_hits:
                best, best_hits = name, hits
        answer = f'{{"label": "{best}"}}'
        return Completion(answer, latency_ms=1.0, tokens_in=0, tokens_out=0)


@dataclass(frozen=True)
class SimProfile:
    accuracy: float
    invalid_rate: float
    latency_base_ms: float
    latency_per_token_ms: float
    pricing: Pricing


SIM_PROFILES: Mapping[str, SimProfile] = {
    "economy": SimProfile(0.83, 0.04, 380, 9, Pricing(60, 60)),
    "balanced": SimProfile(0.91, 0.01, 620, 14, Pricing(400, 400)),
    "flagship": SimProfile(0.96, 0.0, 1100, 22, Pricing(2000, 6000)),
}


class SimulatedProvider:
    """Детерминированный «оракул с шумом» для демонстраций и тестов без обращения к сети.

    Цифры качества задаются профилем и НЕ отражают реальные модели.
    """

    is_baseline = False

    def __init__(self, profile_name: str, task: EvalTask, items: list[EvalItem]) -> None:
        if profile_name not in SIM_PROFILES:
            raise ValueError(f"Неизвестный профиль симулятора: {profile_name}")
        self.name = f"sim:{profile_name}"
        self._profile = SIM_PROFILES[profile_name]
        self.pricing: Pricing | None = self._profile.pricing
        self._task = task
        self._truth = {item.text: item.label for item in items}

    def _rng(self, text: str) -> random.Random:
        digest = hashlib.sha256(f"{self.name}|{text}".encode()).digest()
        return random.Random(int.from_bytes(digest[:8], "big"))

    def complete(self, system: str, user: str) -> Completion:
        match = re.search(r"<ticket>\n?(.*?)\n?</ticket>", user, re.DOTALL)
        text = match.group(1) if match else user
        rng = self._rng(text)
        truth = self._truth.get(text, self._task.fallback_label)
        if rng.random() < self._profile.invalid_rate:
            answer = "Затрудняюсь определить категорию."
        elif rng.random() < self._profile.accuracy:
            answer = f'{{"label": "{truth}"}}'
        else:
            wrong = rng.choice([n for n in self._task.label_names if n != truth])
            answer = f'{{"label": "{wrong}"}}'
        tokens_out = estimate_tokens(answer)
        jitter = 1 + (rng.random() - 0.5) * 0.3
        latency = (
            self._profile.latency_base_ms + self._profile.latency_per_token_ms * tokens_out
        ) * jitter
        return Completion(answer, round(latency, 1), estimate_tokens(system + user), tokens_out)


class OpenAICompatibleProvider:
    """Клиент для любого API формата OpenAI Chat Completions (облака и локальные серверы)."""

    is_baseline = False

    def __init__(
        self,
        base_url: str,
        model: str,
        api_key: str | None = None,
        *,
        name: str | None = None,
        pricing: Pricing | None = None,
        timeout: float = 60.0,
        max_retries: int = 2,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        extra_body: Mapping[str, object] | None = None,
    ) -> None:
        self.name = name or f"api:{model}"
        self.pricing = pricing
        self._model = model
        self._max_retries = max_retries
        self._sleep = sleep
        self._extra_body = dict(extra_body or {})
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(
            base_url=base_url.rstrip("/") + "/",
            timeout=timeout,
            transport=transport,
            headers=headers,
        )

    def complete(self, system: str, user: str) -> Completion:
        payload: dict[str, object] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0,
            "max_tokens": 64,
        }
        payload.update(self._extra_body)
        last_error = "неизвестная ошибка"
        for attempt in range(self._max_retries + 1):
            started = time.perf_counter()
            try:
                response = self._client.post("chat/completions", json=payload)
            except httpx.HTTPError as exc:
                last_error = f"сетевая ошибка: {exc.__class__.__name__}"
            else:
                if response.status_code == 200:
                    return self._parse(response, user, system, started)
                last_error = f"HTTP {response.status_code}"
                if response.status_code not in {429, 500, 502, 503, 504}:
                    break
            if attempt < self._max_retries:
                self._sleep(0.5 * (2**attempt))
        raise ProviderError(last_error)

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _parse(response: httpx.Response, user: str, system: str, started: float) -> Completion:
        latency = (time.perf_counter() - started) * 1000
        try:
            body = response.json()
            text = body["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise ProviderError("неожиданный формат ответа") from exc
        if not isinstance(text, str):
            raise ProviderError("неожиданный формат текста ответа")
        usage = body.get("usage") or {}
        if not isinstance(usage, dict):
            raise ProviderError("неожиданный формат usage")

        def token_count(key: str, fallback: str) -> int:
            value = usage.get(key)
            if value is None:
                return estimate_tokens(fallback)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ProviderError("неожиданный счётчик токенов")
            return value

        return Completion(
            text=text,
            latency_ms=round(latency, 1),
            tokens_in=token_count("prompt_tokens", system + user),
            tokens_out=token_count("completion_tokens", text),
        )
