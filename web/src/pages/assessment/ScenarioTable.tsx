import type { ScenarioResult } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { cx } from "../../lib/cx";
import { formatMonths, formatPercentValue, formatRub } from "../../lib/format";

export function ScenarioTable({ scenarios }: { scenarios: readonly ScenarioResult[] }) {
  return (
    <div className="table-wrap">
      <table className="table table--compact" data-testid="scenario-table">
        <caption className="visually-hidden">Сценарии расчёта: пессимистичный, базовый и оптимистичный</caption>
        <thead>
          <tr>
            <th scope="col">Сценарий</th>
            <th scope="col" className="num-col">В месяц</th>
            <th scope="col" className="num-col">Окупаемость</th>
            <th scope="col" className="num-col">За период</th>
            <th scope="col" className="num-col">ROI</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((scenario) => (
            <tr key={scenario.key} className={cx(scenario.key === "base" && "row--base")}>
              <th scope="row">
                {scenario.label}
                {scenario.key === "base" ? <Badge tone="accent" className="row__badge">основной</Badge> : null}
              </th>
              <td className="num-col num">{formatRub(scenario.net_rub_month)}</td>
              <td className="num-col num">{scenario.payback_months === null ? "—" : formatMonths(scenario.payback_months)}</td>
              <td className="num-col num">{formatRub(scenario.net_horizon_rub)}</td>
              <td className="num-col num">{formatPercentValue(scenario.roi_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
