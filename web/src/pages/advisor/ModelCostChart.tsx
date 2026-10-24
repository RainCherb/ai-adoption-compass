import { useState } from "react";
import type { ModelOption } from "../../api/types";
import { formatNumber, formatRub } from "../../lib/format";

/** Значения берутся из ответа расчётного движка, без отдельной формулы тарифов в UI. */
export function ModelCostChart({ items }: { items: readonly ModelOption[] }) {
  const [unit, setUnit] = useState<"month" | "thousand" | "year">("month");
  if (!items.length) return null;
  const canNormalize = items.every(
    (item) => !item.cost || (item.cost.requests_per_month ?? 0) > 0,
  );
  const factor = (item: ModelOption) =>
    unit === "year"
      ? 12
      : unit === "thousand"
        ? 1000 / (item.cost?.requests_per_month || 1)
        : 1;
  const amount = (item: ModelOption) =>
    (item.cost?.total_usd ?? 0) * factor(item);
  const maximum = Math.max(0, ...items.map(amount));
  const cheapest = Math.min(
    ...items.filter((i) => i.eligible && i.cost?.total_usd != null).map(amount),
  );
  return (
    <section
      className="card cost-comparison"
      aria-label="График примерной стоимости API"
    >
      <header className="card__header">
        <div>
          <h2 className="card__title">Сколько стоит одинаковая нагрузка</h2>
          <p className="muted small">
            Прямые API · без кэша, налогов, комиссий и инструментов. Валютный
            курс — допущение.
          </p>
        </div>
      </header>
      <div className="button-row" role="group" aria-label="Период стоимости">
        {(
          [
            ["month", "В месяц"],
            ["thousand", "За 1 000 запросов"],
            ["year", "В год"],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={value === "thousand" && !canNormalize}
            aria-pressed={unit === value}
            key={value}
            onClick={() => setUnit(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="small muted">
        Год предполагает 12 одинаковых месяцев при выбранном тарифе. Ширина
        полос линейная; состав цены показан цветом и числами.
      </p>
      <div className="cost-chart__legend">
        <span>
          <i className="cost-chart__key cost-chart__key--input" />
          Вход
        </span>
        <span>
          <i className="cost-chart__key cost-chart__key--output" />
          Выход, включая reasoning
        </span>
      </div>
      <ul className="cost-chart" aria-label="Сравнение стоимости моделей">
        {items.map((item) => {
          const value = amount(item);
          const hasBreakdown =
            item.cost?.input_usd != null && item.cost?.output_usd != null;
          const input =
            item.cost?.input_usd != null
              ? item.cost.input_usd * factor(item)
              : value;
          const output =
            item.cost?.output_usd != null
              ? item.cost.output_usd * factor(item)
              : 0;
          return (
            <li key={item.model_id} className="cost-chart__row">
              <div className="cost-chart__label">
                <strong>{item.name}</strong>
                <span>{item.cost?.tariff}</span>
              </div>
              {item.cost?.total_usd != null ? (
                <>
                  <div className="cost-chart__amount num">
                    <strong>${formatNumber(value, 8)}</strong>
                    <span>
                      ≈ {formatRub(item.cost.total_rub * factor(item))}
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 600 22"
                    className="cost-chart__bar"
                    role="img"
                    aria-label={
                      hasBreakdown
                        ? `${item.name}: вход ${formatNumber(input, 8)} $, выход ${formatNumber(output, 8)} $, всего ${formatNumber(value, 8)} $`
                        : `${item.name}: всего ${formatNumber(value, 8)} $, разбивка недоступна`
                    }
                  >
                    <rect
                      width="600"
                      height="22"
                      rx="4"
                      className="cost-chart__track"
                    />
                    <rect
                      width={maximum ? (600 * input) / maximum : 0}
                      height="22"
                      className="cost-chart__input"
                    />
                    <rect
                      x={maximum ? (600 * input) / maximum : 0}
                      width={maximum ? (600 * output) / maximum : 0}
                      height="22"
                      className="cost-chart__output"
                    />
                  </svg>
                  <div className="cost-chart__annotation small">
                    {hasBreakdown
                      ? `Вход $${formatNumber(input, 8)} · выход $${formatNumber(output, 8)}`
                      : "Разбивка по токенам недоступна"}
                    {item.eligible && cheapest > 0 && Number.isFinite(cheapest)
                      ? ` · ${formatNumber(value / cheapest, 2)}× минимальной цены`
                      : ""}
                    {!item.eligible ? " · не проходит ограничения" : ""}
                  </div>
                </>
              ) : (
                <p className="muted">
                  Расчёт недоступен: {item.reasons.join("; ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
