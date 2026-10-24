import { useId, useMemo, useState } from "react";
import type { OptionOut, ProcessResult, Quadrant } from "../../api/types";
import { Icon } from "../../components/ui/Icon";
import { EmptyState } from "../../components/ui/EmptyState";
import { cx } from "../../lib/cx";
import { formatHours, formatMonths, formatRub } from "../../lib/format";
import { QUADRANT_ORDER, QUADRANT_STYLE } from "./quadrants";
import { QuadrantBadge } from "./QuadrantBadge";

type SortKey =
  | "rank"
  | "name"
  | "department"
  | "quadrant"
  | "model"
  | "hours"
  | "implementation"
  | "payback"
  | "net";

interface Column {
  key: SortKey;
  label: string;
  numeric?: boolean;
}

const COLUMNS: readonly Column[] = [
  { key: "rank", label: "№", numeric: true },
  { key: "name", label: "Процесс" },
  { key: "department", label: "Отдел" },
  { key: "quadrant", label: "Квадрант" },
  { key: "model", label: "Модель" },
  { key: "hours", label: "Часов/мес", numeric: true },
  { key: "implementation", label: "Внедрение", numeric: true },
  { key: "payback", label: "Окупаемость", numeric: true },
  { key: "net", label: "Эффект за период", numeric: true },
];

function sortValue(process: ProcessResult, key: SortKey): number | string | null {
  switch (key) {
    case "rank":
      return process.rank;
    case "name":
      return process.name;
    case "department":
      return process.department;
    case "quadrant":
      return QUADRANT_ORDER.indexOf(process.quadrant);
    case "model":
      return process.model?.name ?? null;
    case "hours":
      return process.hours_saved_month;
    case "implementation":
      return process.implementation_rub;
    case "payback":
      return process.payback_months;
    case "net":
      return process.net_horizon_rub;
  }
}

function compare(a: ProcessResult, b: ProcessResult, key: SortKey, direction: 1 | -1): number {
  const left = sortValue(a, key);
  const right = sortValue(b, key);
  // Пустые значения (нет модели, нет срока окупаемости) всегда внизу, независимо от направления.
  if (left === null && right === null) return a.rank - b.rank;
  if (left === null) return 1;
  if (right === null) return -1;
  const result =
    typeof left === "string" && typeof right === "string" ? left.localeCompare(right, "ru") : Number(left) - Number(right);
  return result === 0 ? a.rank - b.rank : result * direction;
}

interface ProcessTableProps {
  processes: readonly ProcessResult[];
  quadrants: readonly OptionOut[];
  horizonMonths: number;
  selectedId?: string | null;
  onOpen: (id: string) => void;
}

export function ProcessTable({ processes, quadrants, horizonMonths, selectedId, onOpen }: ProcessTableProps) {
  const searchId = useId();
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "rank", direction: 1 });
  const [active, setActive] = useState<readonly Quadrant[]>([]);
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const result = new Map<Quadrant, number>();
    for (const process of processes) result.set(process.quadrant, (result.get(process.quadrant) ?? 0) + 1);
    return result;
  }, [processes]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return processes
      .filter((process) => active.length === 0 || active.includes(process.quadrant))
      .filter(
        (process) =>
          needle === "" ||
          process.name.toLowerCase().includes(needle) ||
          process.department.toLowerCase().includes(needle) ||
          process.id.toLowerCase().includes(needle),
      )
      .sort((a, b) => compare(a, b, sort.key, sort.direction));
  }, [processes, active, query, sort]);

  const labelOf = (quadrant: Quadrant) => quadrants.find((option) => option.value === quadrant)?.label ?? quadrant;
  const toggle = (quadrant: Quadrant) =>
    setActive((previous) => (previous.includes(quadrant) ? previous.filter((item) => item !== quadrant) : [...previous, quadrant]));
  const onSort = (key: SortKey) =>
    setSort((previous) => ({ key, direction: previous.key === key && previous.direction === 1 ? -1 : 1 }));

  return (
    <div className="process-table">
      <div className="table-tools">
        <div className="search">
          <Icon name="search" size={16} />
          <label htmlFor={searchId} className="visually-hidden">
            Поиск по процессам
          </label>
          <input
            id={searchId}
            className="input search__input"
            type="search"
            placeholder="Поиск по названию или отделу"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Фильтр по квадрантам">
          {QUADRANT_ORDER.filter((quadrant) => (counts.get(quadrant) ?? 0) > 0).map((quadrant) => (
            <button
              key={quadrant}
              type="button"
              className="chip qchip"
              data-quadrant={quadrant}
              aria-pressed={active.includes(quadrant)}
              onClick={() => toggle(quadrant)}
            >
              <Icon name={QUADRANT_STYLE[quadrant].icon} size={14} />
              {labelOf(quadrant)}
              <span className="chip__count num">{counts.get(quadrant)}</span>
            </button>
          ))}
          {active.length > 0 ? (
            <button type="button" className="chip chip--reset" onClick={() => setActive([])}>
              Сбросить
            </button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState icon="filter" title="Ничего не найдено">
          Измените строку поиска или снимите фильтр по квадрантам.
        </EmptyState>
      ) : (
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Таблица процессов">
          <table className="table table--interactive table--dense">
            <caption className="visually-hidden">Процессы, отсортированные по {COLUMNS.find((c) => c.key === sort.key)?.label}</caption>
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const isActive = sort.key === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={cx(column.numeric && "num-col")}
                      aria-sort={isActive ? (sort.direction === 1 ? "ascending" : "descending") : "none"}
                    >
                      <button type="button" className="th-sort" onClick={() => onSort(column.key)}>
                        {column.key === "net" ? `Эффект за ${horizonMonths} мес.` : column.label}
                        <Icon
                          name={isActive && sort.direction === -1 ? "arrow-down" : "arrow-up"}
                          size={13}
                          className={cx("th-sort__icon", isActive && "th-sort__icon--on")}
                        />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((process) => (
                <tr
                  key={process.id}
                  data-testid="process-row"
                  data-selected={process.id === selectedId || undefined}
                  onClick={() => onOpen(process.id)}
                >
                  <td className="num-col num muted">{process.rank}</td>
                  <th scope="row" className="process-name">
                    <button type="button" className="link-button">
                      {process.name}
                    </button>
                  </th>
                  <td className="dept-cell">{process.department}</td>
                  <td>
                    <QuadrantBadge quadrant={process.quadrant} label={labelOf(process.quadrant)} />
                  </td>
                  <td className="model-cell" title={process.model?.name}>
                    {process.model ? process.model.name : <span className="muted">нет допустимой модели</span>}
                  </td>
                  <td className="num-col num">{formatHours(process.hours_saved_month)}</td>
                  <td className="num-col num">{formatRub(process.implementation_rub)}</td>
                  <td className="num-col num">
                    {process.payback_months === null ? <span className="muted">—</span> : formatMonths(process.payback_months)}
                  </td>
                  <td className="num-col num">
                    <span className={cx(process.net_horizon_rub < 0 && "text-danger")}>{formatRub(process.net_horizon_rub)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="table-note muted small">
        Показано {rows.length} из {processes.length}. Строка открывает подробный расчёт.
      </p>
    </div>
  );
}
