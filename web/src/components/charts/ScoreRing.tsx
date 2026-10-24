import { useId } from "react";
import { cx } from "../../lib/cx";
import type { Tone } from "../ui/Badge";

export function toneForScore(value: number, max = 100): Tone {
  const share = max > 0 ? value / max : 0;
  if (share >= 0.7) return "success";
  if (share >= 0.5) return "warning";
  return "danger";
}

interface ScoreRingProps {
  value: number;
  max?: number;
  /** Что измеряет кольцо — попадёт в aria-label и <title>. */
  label: string;
  size?: number;
  tone?: Tone;
  /** Текст в центре; по умолчанию округлённое значение. */
  center?: string;
  caption?: string;
}

/** Кольцевой индикатор оценки: SVG с <title>/<desc>, цвет дублируется числом. */
export function ScoreRing({ value, max = 100, label, size = 64, tone, center, caption }: ScoreRingProps) {
  const titleId = useId();
  const stroke = Math.max(5, Math.round(size / 9));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(Math.max(value, 0), max);
  const share = max > 0 ? clamped / max : 0;
  const rounded = Math.round(clamped);
  const resolvedTone = tone ?? toneForScore(clamped, max);
  const summary = `${label}: ${rounded} из ${max}`;

  return (
    <figure className={cx("score-ring", `score-ring--${resolvedTone}`)} style={{ width: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby={titleId}
        data-testid="score-ring"
      >
        <title id={titleId}>{summary}</title>
        <circle className="score-ring__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" />
        <circle
          className="score-ring__value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${share * circumference} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text
          className="score-ring__text"
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.round(size * 0.3)}
        >
          {center ?? rounded}
        </text>
      </svg>
      {caption ? <figcaption className="score-ring__caption">{caption}</figcaption> : null}
    </figure>
  );
}
