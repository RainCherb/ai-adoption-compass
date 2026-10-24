import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProcessResult, Quadrant } from "../../api/types";
import { formatHours, formatNumber, formatRub } from "../../lib/format";
import { QUADRANT_ORDER } from "../../pages/assessment/quadrants";
import { QuadrantBadge } from "../../pages/assessment/QuadrantBadge";

const DEFAULT_WIDTH = 720;
const MIN_WIDTH = 300;
const COMPACT_BELOW = 520;
const TICKS = [0, 25, 50, 75, 100];

interface Geometry {
  width: number;
  height: number;
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  rMin: number;
  rMax: number;
  compact: boolean;
  xOf: (ease: number) => number;
  yOf: (impact: number) => number;
}

const clamp = (value: number) => Math.min(Math.max(value, 0), 100);

/**
 * Геометрия пересчитывается по ширине контейнера, а не масштабируется целиком:
 * подписи остаются читаемыми на телефоне. Внутренние поля не дают пузырькам на краях шкалы
 * вылезать за рамку и освобождают место под подписи зон.
 */
function makeGeometry(width: number): Geometry {
  const compact = width < COMPACT_BELOW;
  const height = Math.round(Math.min(Math.max(width * 0.66, 300), 520));
  const left = compact ? 36 : 56;
  const right = compact ? 8 : 20;
  const top = 14;
  const bottom = compact ? 40 : 52;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const padX = compact ? 18 : 30;
  const padY = compact ? 24 : 46;
  return {
    width,
    height,
    left,
    top,
    plotW,
    plotH,
    compact,
    rMin: compact ? 6 : 8,
    rMax: compact ? 16 : 30,
    xOf: (ease) => left + padX + (clamp(ease) / 100) * (plotW - 2 * padX),
    yOf: (impact) => top + padY + (1 - clamp(impact) / 100) * (plotH - 2 * padY),
  };
}

interface QuadrantChartProps {
  processes: readonly ProcessResult[];
  thresholds: { ease: number; impact: number };
  quadrantLabels: Readonly<Record<Quadrant, string>>;
  selectedId?: string | null;
  onSelect: (id: string) => void;
}

/**
 * Пузырьковая диаграмма «эффект × лёгкость»: радиус ~ √(часы экономии в месяц), цвет — квадрант.
 * Каждый пузырёк — кнопка (Tab, Enter/Пробел); те же данные продублированы в таблице процессов.
 */
export function QuadrantChart({ processes, thresholds, quadrantLabels, selectedId, onSelect }: QuadrantChartProps) {
  const titleId = useId();
  const descId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(MIN_WIDTH, Math.round(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const geo = useMemo(() => makeGeometry(width), [width]);
  const { left, top, plotW, plotH, xOf, yOf } = geo;

  const points = useMemo(() => {
    const maxHours = Math.max(1, ...processes.map((p) => p.hours_saved_month));
    return processes
      .map((process) => ({
        process,
        x: xOf(process.ease),
        y: yOf(process.impact),
        r: geo.rMin + (geo.rMax - geo.rMin) * Math.sqrt(Math.max(process.hours_saved_month, 0) / maxHours),
      }))
      .sort((a, b) => b.r - a.r);
  }, [processes, geo, xOf, yOf]);

  const counts = useMemo(() => {
    const result: Record<Quadrant, number> = { quick_win: 0, strategic: 0, fill_in: 0, postpone: 0, blocked: 0 };
    for (const process of processes) result[process.quadrant] += 1;
    return result;
  }, [processes]);

  const tx = xOf(thresholds.ease);
  const ty = yOf(thresholds.impact);
  const right = left + plotW;
  const bottom = top + plotH;
  const active = points.find((point) => point.process.id === activeId);

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };

  return (
    <div className="chart">
      <div className="chart__canvas" ref={canvasRef}>
        <svg
          className="chart__svg"
          width={geo.width}
          height={geo.height}
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          role="group"
          aria-labelledby={titleId}
          aria-describedby={descId}
          data-testid="quadrant-chart"
        >
          <title id={titleId}>Матрица «эффект — лёгкость внедрения»</title>
          <desc id={descId}>
            Диаграмма из {processes.length} процессов. По горизонтали — лёгкость внедрения, по вертикали — эффект, радиус
            пузырька — часы экономии в месяц, цвет и подпись — квадрант. Те же данные есть в таблице ниже.
          </desc>

          <rect className="chart__zone chart__zone--strategic" x={left} y={top} width={tx - left} height={ty - top} />
          <rect className="chart__zone chart__zone--quick_win" x={tx} y={top} width={right - tx} height={ty - top} />
          <rect className="chart__zone chart__zone--postpone" x={left} y={ty} width={tx - left} height={bottom - ty} />
          <rect className="chart__zone chart__zone--fill_in" x={tx} y={ty} width={right - tx} height={bottom - ty} />

          {TICKS.map((tick) => (
            <g key={tick}>
              <line className="chart__grid" x1={xOf(tick)} x2={xOf(tick)} y1={top} y2={bottom} />
              <line className="chart__grid" x1={left} x2={right} y1={yOf(tick)} y2={yOf(tick)} />
              <text className="chart__tick-label" x={xOf(tick)} y={bottom + 16} textAnchor="middle">
                {tick}
              </text>
              <text className="chart__tick-label" x={left - 8} y={yOf(tick)} textAnchor="end" dominantBaseline="central">
                {tick}
              </text>
            </g>
          ))}

          {geo.compact ? null : (
            <>
              <text className="chart__zone-label" x={right - 10} y={top + 18} textAnchor="end">
                {quadrantLabels.quick_win}
              </text>
              <text className="chart__zone-label" x={left + 10} y={top + 18}>
                {quadrantLabels.strategic}
              </text>
              <text className="chart__zone-label" x={right - 10} y={bottom - 10} textAnchor="end">
                {quadrantLabels.fill_in}
              </text>
              <text className="chart__zone-label" x={left + 10} y={bottom - 10}>
                {quadrantLabels.postpone}
              </text>
            </>
          )}

          <line className="chart__threshold" data-testid="threshold-ease" x1={tx} x2={tx} y1={top} y2={bottom} />
          <line className="chart__threshold" data-testid="threshold-impact" x1={left} x2={right} y1={ty} y2={ty} />
          <text className="chart__threshold-label" x={tx + 5} y={top + 12}>
            порог {formatNumber(thresholds.ease)}
          </text>
          <text className="chart__threshold-label" x={right - 4} y={ty - 5} textAnchor="end">
            порог {formatNumber(thresholds.impact)}
          </text>

          <text className="chart__axis-title" x={left + plotW / 2} y={geo.height - 6} textAnchor="middle">
            Лёгкость внедрения →
          </text>
          <text
            className="chart__axis-title"
            transform={`translate(${geo.compact ? 9 : 14} ${top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            Эффект →
          </text>

          {points.map(({ process, x, y, r }) => {
            const selected = process.id === selectedId;
            const label = `${process.rank}. ${process.name} — ${quadrantLabels[process.quadrant]}. Лёгкость ${formatNumber(process.ease)}, эффект ${formatNumber(process.impact)}, экономия ${formatHours(process.hours_saved_month)} в месяц`;
            return (
              <g
                key={process.id}
                className="qpoint"
                data-testid="chart-point"
                data-id={process.id}
                data-quadrant={process.quadrant}
                data-selected={selected || undefined}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={selected}
                onClick={() => onSelect(process.id)}
                onKeyDown={(event) => onKeyDown(event, process.id)}
                onMouseEnter={() => setActiveId(process.id)}
                onMouseLeave={() => setActiveId(null)}
                onFocus={() => setActiveId(process.id)}
                onBlur={() => setActiveId(null)}
              >
                {selected ? <circle className="qpoint__ring" cx={x} cy={y} r={r + 5} /> : null}
                <circle className="qpoint__dot" cx={x} cy={y} r={r} />
                {r >= 11 ? (
                  <text className="qpoint__rank" x={x} y={y} textAnchor="middle" dominantBaseline="central">
                    {process.quadrant === "blocked" ? "×" : process.rank}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {active ? (
          <div
            className="chart-tooltip"
            data-testid="chart-tooltip"
            data-x={active.x > geo.width * 0.6 ? "left" : "right"}
            data-y={active.y < geo.height * 0.35 ? "down" : "up"}
            style={{ left: `${(active.x / geo.width) * 100}%`, top: `${(active.y / geo.height) * 100}%` }}
            aria-hidden="true"
          >
            <strong>{active.process.name}</strong>
            <span>{active.process.model?.name ?? "Нет допустимого API"}</span>
            <span>{quadrantLabels[active.process.quadrant]}</span>
            <span>
              Лёгкость {formatNumber(active.process.ease)} · эффект {formatNumber(active.process.impact)}
            </span>
            <span>
              {formatHours(active.process.hours_saved_month)}/мес · {formatRub(active.process.net_month_rub)}/мес
            </span>
            <span>API: {formatRub(active.process.llm_cost_month_rub)}/мес · чистый эффект за период {formatRub(active.process.net_horizon_rub)}</span>
          </div>
        ) : null}
      </div>

      <ul className="chart-legend" aria-label="Квадранты">
        {QUADRANT_ORDER.filter((quadrant) => counts[quadrant] > 0).map((quadrant) => (
          <li key={quadrant}>
            <QuadrantBadge quadrant={quadrant} label={quadrantLabels[quadrant]} />
            <span className="num">{counts[quadrant]}</span>
          </li>
        ))}
        <li className="chart-legend__note">Размер пузырька — часы экономии в месяц</li>
      </ul>
    </div>
  );
}
