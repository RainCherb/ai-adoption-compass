import type { EvalReport } from "../../api/types";
import { InlineBar } from "../../components/charts/InlineBar";
import { Badge } from "../../components/ui/Badge";
import { cx } from "../../lib/cx";
import { formatLatency, formatPercent, formatPointsDelta, formatRub, formatRubPrecise } from "../../lib/format";

export function providerKind(provider: string): { label: string; tone: "neutral" | "info" | "accent" } {
  if (provider.startsWith("baseline")) return { label: "правила", tone: "neutral" };
  if (provider.startsWith("sim:")) return { label: "симуляция", tone: "info" };
  return { label: "API", tone: "accent" };
}

/** Лучшая точность и самый дешёвый прогон среди моделей (baseline бесплатен по определению и не считается). */
export function pickHighlights(reports: readonly EvalReport[]): { best: string | null; cheapest: string | null } {
  let best: EvalReport | undefined;
  for (const report of reports) {
    if (!best || report.metrics.accuracy > best.metrics.accuracy) best = report;
  }
  let cheapest: EvalReport | undefined;
  for (const report of reports) {
    if (report.is_baseline || report.cost_rub === null) continue;
    if (!cheapest || report.cost_rub < (cheapest.cost_rub ?? Infinity)) cheapest = report;
  }
  return { best: best?.provider ?? null, cheapest: cheapest?.provider ?? null };
}

interface ComparisonTableProps {
  reports: readonly EvalReport[];
  selected: string;
  onSelect: (provider: string) => void;
}

export function ComparisonTable({ reports, selected, onSelect }: ComparisonTableProps) {
  const { best, cheapest } = pickHighlights(reports);
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Сравнение моделей">
      <table className="table table--interactive table--dense" data-testid="eval-table">
        <caption className="visually-hidden">Сравнение моделей по точности, задержке и стоимости</caption>
        <thead>
          <tr>
            <th scope="col">Провайдер</th>
            <th scope="col">Точность</th>
            <th scope="col" className="num-col">macro-F1</th>
            <th scope="col" className="num-col" title="Ответы, которые не удалось разобрать">
              Невалид.
            </th>
            <th scope="col" className="num-col" title="Медианная задержка ответа">
              p50
            </th>
            <th scope="col" className="num-col" title="95-й перцентиль задержки">
              p95
            </th>
            <th scope="col" className="num-col" title="Стоимость прогона по всему набору">
              Стоимость
            </th>
            <th scope="col" className="num-col" title="Стоимость одного верного ответа">
              За верный
            </th>
            <th scope="col" className="num-col" title="Прирост точности к baseline, п.п.">
              К baseline
            </th>
          </tr>
        </thead>
        <tbody>
          {reports.map((report) => {
            const kind = providerKind(report.provider);
            const lift = report.accuracy_lift;
            return (
              <tr
                key={report.provider}
                data-testid="eval-row"
                data-selected={report.provider === selected || undefined}
                onClick={() => onSelect(report.provider)}
              >
                <th scope="row">
                  <span className="provider-line">
                    <button type="button" className="link-button" aria-pressed={report.provider === selected}>
                      <code>{report.provider}</code>
                    </button>
                    <Badge tone={kind.tone}>{kind.label}</Badge>
                  </span>
                  <span className="provider-badges">
                    {report.provider === best ? (
                      <Badge tone="success" icon="check">
                        лучшая точность
                      </Badge>
                    ) : null}
                    {report.provider === cheapest ? (
                      <Badge tone="accent" icon="check">
                        самая дешёвая
                      </Badge>
                    ) : null}
                  </span>
                </th>
                <td className="bar-cell">
                  <InlineBar share={report.metrics.accuracy} text={formatPercent(report.metrics.accuracy, 1)} />
                </td>
                <td className="num-col num">{formatPercent(report.metrics.macro_f1, 1)}</td>
                <td className="num-col num">{report.metrics.invalid}</td>
                <td className="num-col num">{formatLatency(report.latency.p50_ms)}</td>
                <td className="num-col num">{formatLatency(report.latency.p95_ms)}</td>
                <td className="num-col num">{report.cost_rub === null ? "—" : formatRub(report.cost_rub)}</td>
                <td className="num-col num">{report.cost_per_correct_rub === null ? "—" : formatRubPrecise(report.cost_per_correct_rub)}</td>
                <td className={cx("num-col num", lift != null && lift > 0 && "text-success", lift != null && lift < 0 && "text-danger")}>
                  {report.is_baseline ? <span className="muted">база</span> : formatPointsDelta(lift)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
