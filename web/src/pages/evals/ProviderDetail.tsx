import type { EvalReport, EvalTask } from "../../api/types";
import { ConfusionMatrix } from "../../components/charts/ConfusionMatrix";
import { InlineBar } from "../../components/charts/InlineBar";
import { Badge } from "../../components/ui/Badge";
import { formatNumber, formatPercent } from "../../lib/format";

interface ProviderDetailProps {
  report: EvalReport;
  task: EvalTask;
}

export function ProviderDetail({ report, task }: ProviderDetailProps) {
  const titles = Object.fromEntries(task.labels.map((label) => [label.name, label.title]));
  const title = (name: string | null) => (name === null ? "нет валидного ответа" : (titles[name] ?? name));
  const { metrics } = report;

  return (
    <section className="stack" aria-labelledby="provider-title" data-testid="provider-detail">
      <header>
        <h3 id="provider-title" className="section__subtitle">
          Разбор: <code>{report.provider}</code>
        </h3>
        <p className="muted">
          Точность {formatPercent(metrics.accuracy, 1)}, macro-F1 {formatPercent(metrics.macro_f1, 1)}, примеров: {metrics.n}
          {metrics.invalid > 0 ? `, невалидных ответов: ${metrics.invalid} (в матрицу не попадают, но снижают точность)` : ""}.
        </p>
      </header>

      <div className="eval-detail-grid">
        <div className="card">
          <h4 className="card__title">Матрица ошибок</h4>
          <ConfusionMatrix labels={metrics.labels} matrix={metrics.confusion} titles={titles} />
        </div>

        <div className="card">
          <h4 className="card__title">По классам</h4>
          <div className="table-wrap">
            <table className="table table--compact" data-testid="per-class-table">
              <caption className="visually-hidden">Точность, полнота и F1 по классам</caption>
              <thead>
                <tr>
                  <th scope="col">Класс</th>
                  <th scope="col" className="num-col">Precision</th>
                  <th scope="col" className="num-col">Recall</th>
                  <th scope="col">F1</th>
                  <th scope="col" className="num-col" title="Сколько примеров этого класса в наборе">
                    Всего
                  </th>
                </tr>
              </thead>
              <tbody>
                {metrics.per_class.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{title(row.label)}</th>
                    <td className="num-col num">{formatPercent(row.precision)}</td>
                    <td className="num-col num">{formatPercent(row.recall)}</td>
                    <td className="bar-cell">
                      <InlineBar share={row.f1} text={formatNumber(row.f1, 2, 2)} />
                    </td>
                    <td className="num-col num">{row.support}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h4 className="card__title">Примеры ошибок</h4>
        {report.failures.length === 0 ? (
          <p className="muted">Ошибок на этом наборе нет.</p>
        ) : (
          <ul className="failures">
            {report.failures.map((failure) => (
              <li key={failure.id} className="failure">
                <q className="failure__text">{failure.text}</q>
                <span className="failure__verdict">
                  ожидалось <Badge tone="success">{title(failure.expected)}</Badge> · ответ{" "}
                  <Badge tone={failure.got === null ? "danger" : "warning"}>{title(failure.got)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
