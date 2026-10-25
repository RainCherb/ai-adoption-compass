import { reasonKindLabel } from "../../lib/labels";
import { useState } from "react";
import type { ModelOption } from "../../api/types";
import { Icon } from "../../components/ui/Icon";
import { cx } from "../../lib/cx";
import { formatDollars, formatNumber, formatRubPrecise } from "../../lib/format";
import { priceBasis, taxNote } from "../../lib/pricing";
import { RussiaAccess } from "./RussiaAccess";

type Unit = "month" | "thousand" | "year";

const UNITS: readonly (readonly [Unit, string])[] = [
  ["month", "В месяц"],
  ["thousand", "За 1 000 запросов"],
  ["year", "В год"],
];

interface Row {
  item: ModelOption;
  /** Сумма за выбранный период в рублях; null — расчёта нет. */
  total: number | null;
  split: { input: number; output: number } | null;
  usd: number | null;
}

interface PricedRow extends Row {
  total: number;
}

const BAR_WIDTH = 600;

/** Рубли — основная единица; значения берутся из ответа расчётного движка, без отдельной формулы тарифов в UI. */
export function ModelCostChart({ items, usdRub }: { items: readonly ModelOption[]; usdRub: number }) {
  const [unit, setUnit] = useState<Unit>("month");
  if (!items.length) return null;
  const canNormalize = items.every((item) => !item.cost || (item.cost.requests_per_month ?? 0) > 0);
  const period = unit === "thousand" && !canNormalize ? "month" : unit;

  const rows = items.map<Row>((item) => {
    const { cost } = item;
    if (!cost) return { item, total: null, split: null, usd: null };
    const factor = period === "year" ? 12 : period === "thousand" ? 1000 / (cost.requests_per_month || 1) : 1;
    return {
      item,
      total: cost.total_rub * factor,
      split:
        cost.input_rub != null && cost.output_rub != null
          ? { input: cost.input_rub * factor, output: cost.output_rub * factor }
          : null,
      usd: cost.total_usd != null ? cost.total_usd * factor : null,
    };
  });
  const priced = rows.filter((row): row is PricedRow => row.total !== null).sort((a, b) => a.total - b.total);
  const ordered = [...priced, ...rows.filter((row) => row.total === null)];
  const maximum = Math.max(0, ...priced.map((row) => row.total));
  const suitable = priced.filter((row) => row.item.eligible).map((row) => row.total);
  const cheapest = suitable.length > 0 ? Math.min(...suitable) : 0;

  return (
    <section className="card cost-comparison" aria-label="График примерной стоимости API">
      <header className="card__header">
        <div>
          <h2 className="card__title">Сколько стоит одинаковая нагрузка</h2>
          <p className="muted small">
            Российские тарифы — в рублях с НДС 22&nbsp;%, зарубежные — в долларах без налогов; пересчёт по курсу{" "}
            {formatNumber(usdRub, 2)}&nbsp;₽/$. Расчёт без кэша, асинхронного режима и скидок.
          </p>
        </div>
      </header>
      <div className="button-row" role="group" aria-label="Период стоимости">
        {UNITS.map(([value, label]) => (
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={value === "thousand" && !canNormalize}
            aria-pressed={period === value}
            key={value}
            onClick={() => setUnit(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="small muted">
        Год — 12 одинаковых месяцев при выбранном тарифе. Ширина полос линейная; состав цены показан цветом и числами.
        Модели в порядке роста цены.
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
        {ordered.map((row) => (
          <CostRow key={row.item.model_id} row={row} maximum={maximum} cheapest={cheapest} />
        ))}
      </ul>
    </section>
  );
}

function CostRow({ row, maximum, cheapest }: { row: Row; maximum: number; cheapest: number }) {
  const { item, total, split, usd } = row;
  const basis = priceBasis(item.cost, item.profile);
  const secondary = !basis
    ? null
    : basis.currency === "USD"
      ? `≈ ${formatDollars(usd)} ${taxNote(basis)}`
      : `цена ${taxNote(basis)}`;
  const share = (value: number) => (maximum > 0 ? (BAR_WIDTH * value) / maximum : 0);
  const warning = item.cost?.price_warning;

  return (
    <li className={cx("cost-chart__row", !item.eligible && "cost-chart__row--excluded")}>
      <div className="cost-chart__label">
        <span className="cost-chart__name">
          <strong>{item.name}</strong>
          <RussiaAccess profile={item.profile} />
        </span>
        <span>{item.cost?.tariff}</span>
      </div>
      {total !== null ? (
        <>
          <div className="cost-chart__amount num">
            <strong>{formatRubPrecise(total)}</strong>
            {secondary ? <span>{secondary}</span> : null}
          </div>
          <svg
            viewBox={`0 0 ${BAR_WIDTH} 22`}
            className="cost-chart__bar"
            role="img"
            aria-label={
              split
                ? `${item.name}: вход ${formatRubPrecise(split.input)}, выход ${formatRubPrecise(split.output)}, всего ${formatRubPrecise(total)}`
                : `${item.name}: всего ${formatRubPrecise(total)}, разбивка недоступна`
            }
          >
            <rect width={BAR_WIDTH} height="22" rx="4" className="cost-chart__track" />
            <rect width={share(split ? split.input : total)} height="22" className="cost-chart__input" />
            <rect
              x={share(split ? split.input : total)}
              width={share(split ? split.output : 0)}
              height="22"
              className="cost-chart__output"
            />
          </svg>
          <div className="cost-chart__annotation small">
            {split
              ? `Вход ${formatRubPrecise(split.input)} · выход ${formatRubPrecise(split.output)}`
              : "Разбивка по токенам недоступна"}
            {item.eligible && cheapest > 0 ? ` · ${formatNumber(total / cheapest, 2)}× цены самой дешёвой подходящей` : ""}
            {!item.eligible ? (
              <span className="cost-chart__excluded">
                {" · "}
                {item.reasons.length > 0 ? `не подходит: ${(item.kinds?.length ? item.kinds.map(reasonKindLabel) : item.reasons).join(", ")}` : "не подходит"}
              </span>
            ) : null}
          </div>
          {warning ? (
            <p className="cost-chart__warning small">
              <Icon name="alert" size={14} />
              <span>{warning}</span>
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted">Расчёт недоступен: {item.reasons.join("; ")}</p>
      )}
    </li>
  );
}
