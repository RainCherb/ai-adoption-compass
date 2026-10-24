import { Fragment, useMemo } from "react";
import type { Finding } from "../../api/types";
import { cx } from "../../lib/cx";
import { splitByFindings } from "../../lib/findings";
import { CONFIDENCE_LABELS } from "../../lib/labels";

interface HighlightedTextProps {
  text: string;
  findings: readonly Finding[];
}

/** Исходный текст с подсвеченными находками; секреты — красным, к метке добавлен текстовый ярлык. */
export function HighlightedText({ text, findings }: HighlightedTextProps) {
  const segments = useMemo(() => splitByFindings(text, findings), [text, findings]);
  return (
    <div className="highlight" role="region" aria-label="Текст с подсвеченными находками" tabIndex={0}>
      <p className="highlight__text" data-testid="highlighted-text">
        {segments.map((segment, index) =>
          segment.finding ? (
            <mark
              key={index}
              className={cx("mark", segment.finding.is_secret && "mark--secret")}
              data-kind={segment.finding.kind}
              data-label={segment.finding.label}
              title={`${segment.finding.label} · уверенность: ${CONFIDENCE_LABELS[segment.finding.confidence] ?? segment.finding.confidence}`}
            >
              {segment.text}
            </mark>
          ) : (
            <Fragment key={index}>{segment.text}</Fragment>
          ),
        )}
      </p>
    </div>
  );
}
