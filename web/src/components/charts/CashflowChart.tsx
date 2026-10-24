import { useId, useState } from "react";
import type { AssessmentResult } from "../../api/types";
import {
  formatMonths,
  formatNumber,
  formatRub,
  formatRubCompact,
} from "../../lib/format";

type Row = NonNullable<AssessmentResult["portfolio_scenarios"]>[number];

export function cashflowAt(row: Row, month: number, horizon: number): number {
  if (month === 0) return -row.implementation_rub;
  if (month === horizon) return row.net_horizon_rub;
  return (
    -row.implementation_rub +
    ((row.net_horizon_rub + row.implementation_rub) * month) / horizon
  );
}

export function CashflowChart({
  rows,
  horizon,
}: {
  rows: readonly Row[];
  horizon: number;
}) {
  const id = useId();
  const [month, setMonth] = useState<number | null>(null);
  if (!rows.length) return null;
  const selectedMonth = Math.min(month ?? horizon, horizon);
  const minimum = Math.min(
    0,
    ...rows.map((row) => -row.implementation_rub),
    ...rows.map((row) => row.net_horizon_rub),
  );
  const maximum = Math.max(0, ...rows.map((row) => row.net_horizon_rub));
  const roughStep = Math.max(5, maximum - minimum) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step =
    ([1, 2, 2.5, 5, 10].find((n) => n * magnitude >= roughStep) ?? 10) *
    magnitude;
  const low = Math.floor(minimum / step) * step;
  const high = Math.max(low + step, Math.ceil(maximum / step) * step);
  const span = high - low;
  const ticks = Array.from(
    { length: Math.round(span / step) + 1 },
    (_, i) => low + i * step,
  );
  const x = (m: number) => 86 + (m / horizon) * 780;
  const y = (value: number) =>
    24 + ((high + span * 0.08 - value) / (span * 1.16)) * 244;
  const months = [
    ...new Set([
      0,
      Math.round(horizon / 4),
      Math.round(horizon / 2),
      Math.round((3 * horizon) / 4),
      horizon,
    ]),
  ];
  return (
    <section className="card cashflow" aria-label="График накопленного эффекта">
      <header className="card__header">
        <div>
          <h2 className="card__title">Когда инвестиции возвращаются</h2>
          <p className="small muted">
            Один и тот же план внедрения в трёх сценариях. Все суммы — после API
            и сопровождения.
          </p>
        </div>
      </header>
      <div
        className="cashflow__plot"
        tabIndex={0}
        role="region"
        aria-label="Линии сценариев накопленного эффекта"
      >
        <svg
          viewBox="0 0 900 320"
          role="img"
          aria-labelledby={`${id}-title ${id}-desc`}
        >
          <title id={`${id}-title`}>
            Накопленный чистый эффект за {horizon} месяцев
          </title>
          <desc id={`${id}-desc`}>
            В месяце 0 списывается внедрение. Горизонтальная ось — месяц,
            вертикальная — рубли. Пессимистичный, базовый и оптимистичный
            сценарии; точные значения в таблице.
          </desc>
          {ticks.map((value) => {
            return (
              <g key={value}>
                <line
                  className="cashflow__grid"
                  x1="86"
                  x2="866"
                  y1={y(value)}
                  y2={y(value)}
                />
                <text
                  className="cashflow__tick"
                  x="76"
                  y={y(value) + 4}
                  textAnchor="end"
                >
                  {formatRubCompact(value)}
                </text>
              </g>
            );
          })}
          <line
            className="cashflow__zero"
            x1="86"
            x2="866"
            y1={y(0)}
            y2={y(0)}
          />
          {months.map((m) => (
            <g key={m}>
              <text
                className="cashflow__tick"
                x={x(m)}
                y="290"
                textAnchor="middle"
              >
                {m}
              </text>
            </g>
          ))}
          <text className="cashflow__tick" x="866" y="313" textAnchor="end">
            Месяц →
          </text>
          {rows.map((row) => (
            <path
              key={row.key}
              className={`cashflow__line cashflow__line--${row.key}`}
              d={`M ${x(0)} ${y(-row.implementation_rub)} L ${x(horizon)} ${y(row.net_horizon_rub)}`}
            />
          ))}
          <line
            className="cashflow__cursor"
            x1={x(selectedMonth)}
            x2={x(selectedMonth)}
            y1="16"
            y2="270"
          />
          {rows.map((row) => (
            <circle
              key={row.key}
              className={`cashflow__dot cashflow__dot--${row.key}`}
              cx={x(selectedMonth)}
              cy={y(cashflowAt(row, selectedMonth, horizon))}
              r="5"
            />
          ))}
        </svg>
      </div>
      <label className="cashflow__control">
        Месяц: {selectedMonth}
        <input
          type="range"
          min="0"
          max={horizon}
          step="1"
          value={selectedMonth}
          onChange={(event) => setMonth(Number(event.target.value))}
        />
      </label>
      <div className="table-wrap">
        <table className="table table--compact">
          <caption className="visually-hidden">
            Денежный эффект на выбранный месяц
          </caption>
          <thead>
            <tr>
              <th>Сценарий</th>
              <th>Месяц {selectedMonth}</th>
              <th>Окупаемость</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row">
                  <span
                    className={`cashflow__swatch cashflow__swatch--${row.key}`}
                  />
                  {row.label}
                </th>
                <td className="num">
                  {formatRub(cashflowAt(row, selectedMonth, horizon))}
                </td>
                <td>
                  {row.payback_months == null
                    ? "Не окупается"
                    : formatMonths(row.payback_months)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        Разовое внедрение списано сразу; постоянная выгода начинается в
        следующем месяце. Поэтапный запуск, дисконтирование и налоги не
        учитываются. Горизонт {formatNumber(horizon)} мес.; допущения можно
        изменить выше.
      </p>
    </section>
  );
}
