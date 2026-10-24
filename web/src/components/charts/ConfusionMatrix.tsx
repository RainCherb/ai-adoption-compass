import { type CSSProperties } from "react";

interface ConfusionMatrixProps {
  labels: readonly string[];
  /** matrix[i][j]: ожидался класс i, модель ответила j. */
  matrix: readonly (readonly number[])[];
  /** Человекочитаемые названия классов по имени. */
  titles?: Readonly<Record<string, string>>;
  actualTitle?: string;
  predictedTitle?: string;
}

/** Матрица ошибок как таблица-«тепловая карта»: цвет — доля строки, число — количество. */
export function ConfusionMatrix({
  labels,
  matrix,
  titles = {},
  actualTitle = "Ожидаемый класс",
  predictedTitle = "Ответ модели",
}: ConfusionMatrixProps) {
  const title = (name: string) => titles[name] ?? name;

  return (
    <div className="confusion-wrap">
      <table className="confusion">
        <caption className="visually-hidden">
          Матрица ошибок: строки — {actualTitle.toLowerCase()}, столбцы — {predictedTitle.toLowerCase()}
        </caption>
        <thead>
          <tr>
            <td className="confusion__corner" rowSpan={2} />
            <th className="confusion__axis" colSpan={labels.length} scope="colgroup">
              {predictedTitle} →
            </th>
          </tr>
          <tr>
            {labels.map((label) => (
              <th key={label} scope="col" className="confusion__col" title={title(label)}>
                <span>{title(label)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((rowLabel, rowIndex) => {
            const row = matrix[rowIndex] ?? [];
            const total = row.reduce((sum, value) => sum + value, 0); // для интенсивности цвета: доля строки
            return (
              <tr key={rowLabel}>
                <th scope="row" className="confusion__row" title={`${actualTitle}: ${title(rowLabel)}`}>
                  {title(rowLabel)}
                </th>
                {labels.map((colLabel, colIndex) => {
                  const value = row[colIndex] ?? 0;
                  const hit = rowIndex === colIndex;
                  const intensity = total > 0 ? value / total : 0;
                  const style = { "--v": value > 0 ? Math.max(intensity, 0.12) : 0 } as CSSProperties;
                  return (
                    <td
                      key={colLabel}
                      className={hit ? "confusion__cell confusion__cell--hit" : "confusion__cell confusion__cell--miss"}
                      style={style}
                      data-value={value}
                      title={`Ожидалось «${title(rowLabel)}», ответ «${title(colLabel)}»: ${value}`}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="confusion__legend">
        Строки — {actualTitle.toLowerCase()}. Диагональ (зелёная) — верные ответы, остальное (красное) — ошибки.
      </p>
    </div>
  );
}
