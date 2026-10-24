"""Движок безопасности: анализ текста, классификация и решения по политике."""

from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import BaseModel

from ..domain import DEPLOYMENT_LABELS, Action, Deployment, Sensitivity, max_sensitivity
from .detectors import DEFAULT_DETECTORS, DetectorSpec, Finding, find_findings
from .masking import MaskResult, mask_text, unmask_text
from .policy import Policy


class FindingOut(BaseModel):
    """Находка для API и отчётов: без исходного значения, только безопасный превью."""

    kind: str
    label: str
    tag: str
    start: int
    end: int
    preview: str
    implied_sensitivity: Sensitivity
    is_secret: bool
    confidence: str


class Decision(BaseModel):
    target: Deployment
    action: Action
    reasons: list[str]


class SafetyReport(BaseModel):
    chars: int
    findings: list[FindingOut]
    counts: dict[str, int]
    declared_sensitivity: Sensitivity
    detected_sensitivity: Sensitivity | None
    effective_sensitivity: Sensitivity
    has_secrets: bool
    decisions: list[Decision]
    masked_text: str

    def decision_for(self, target: Deployment) -> Decision:
        return next(d for d in self.decisions if d.target is target)


@dataclass(frozen=True)
class SafetyAnalysis:
    """Результат анализа: безопасный отчёт + внутренние данные для обезличивания."""

    report: SafetyReport
    findings: list[Finding]
    masked: MaskResult


def _summary(findings: Sequence[Finding]) -> str:
    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.label] = counts.get(finding.label, 0) + 1
    return ", ".join(f"{label.lower()} ×{n}" for label, n in counts.items())


class SafetyGuard:
    def __init__(
        self, policy: Policy, detectors: Sequence[DetectorSpec] = DEFAULT_DETECTORS
    ) -> None:
        self.policy = policy
        self.detectors = tuple(detectors)

    def scan(self, text: str) -> list[Finding]:
        return find_findings(text, self.detectors)

    def mask(self, text: str) -> MaskResult:
        return mask_text(text, self.scan(text))

    @staticmethod
    def unmask(text: str, mapping: dict[str, str]) -> str:
        return unmask_text(text, mapping)

    def analyze(self, text: str, declared: Sensitivity = Sensitivity.INTERNAL) -> SafetyAnalysis:
        """Найти чувствительные данные и принять решение для каждого размещения модели."""
        findings = self.scan(text)
        has_secrets = any(f.is_secret for f in findings)
        detected = max_sensitivity(*(f.implied for f in findings)) if findings else None
        effective = max_sensitivity(declared, detected) if detected else declared
        masked = mask_text(text, findings)
        decisions = [
            self._decide(target, effective, has_secrets, findings) for target in Deployment
        ]
        counts: dict[str, int] = {}
        for finding in findings:
            counts[finding.kind] = counts.get(finding.kind, 0) + 1
        report = SafetyReport(
            chars=len(text),
            findings=[
                FindingOut(
                    kind=f.kind,
                    label=f.label,
                    tag=f.tag,
                    start=f.start,
                    end=f.end,
                    preview=f.preview,
                    implied_sensitivity=f.implied,
                    is_secret=f.is_secret,
                    confidence=f.confidence,
                )
                for f in findings
            ],
            counts=counts,
            declared_sensitivity=declared,
            detected_sensitivity=detected,
            effective_sensitivity=effective,
            has_secrets=has_secrets,
            decisions=decisions,
            masked_text=masked.text,
        )
        return SafetyAnalysis(report=report, findings=findings, masked=masked)

    def _decide(
        self,
        target: Deployment,
        effective: Sensitivity,
        has_secrets: bool,
        findings: Sequence[Finding],
    ) -> Decision:
        if has_secrets:
            message = self.policy.document.secrets.message.strip()
            return Decision(
                target=target, action=self.policy.document.secrets.action, reasons=[message]
            )
        action = self.policy.action(effective, target)
        category = self.policy.label(effective).lower()
        place = DEPLOYMENT_LABELS[target]
        if action is Action.ALLOW:
            reason = f"Категория «{category}»: отправка в «{place}» разрешена."
        elif action is Action.MASK:
            found = _summary(findings)
            suffix = f" Найдено: {found}." if found else ""
            reason = f"Категория «{category}»: в «{place}» — только после обезличивания.{suffix}"
        else:
            reason = f"Категория «{category}»: отправка в «{place}» запрещена политикой."
        return Decision(target=target, action=action, reasons=[reason])
