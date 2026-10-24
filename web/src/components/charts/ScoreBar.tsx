import { cx } from "../../lib/cx";
import type { Tone } from "../ui/Badge";
import { toneForScore } from "./ScoreRing";

interface ScoreBarProps {
  label: string;
  value: number;
  max?: number;
  tone?: Tone;
  /** Подпись справа; по умолчанию округлённое значение. */
  valueText?: string;
  hint?: string;
}

export function ScoreBar({ label, value, max = 100, tone, valueText, hint }: ScoreBarProps) {
  const clamped = Math.min(Math.max(value, 0), max);
  const share = max > 0 ? clamped / max : 0;
  const text = valueText ?? String(Math.round(clamped));
  return (
    <div className="score-bar">
      <div className="score-bar__head">
        <span className="score-bar__label" title={hint}>
          {label}
        </span>
        <span className="score-bar__value num">{text}</span>
      </div>
      <div
        className="score-bar__track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.round(clamped * 100) / 100}
        aria-valuetext={text}
      >
        <span
          className={cx("score-bar__fill", `score-bar__fill--${tone ?? toneForScore(clamped, max)}`)}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}
