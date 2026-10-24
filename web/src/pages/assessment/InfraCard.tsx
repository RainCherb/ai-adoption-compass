import type { InfraLine, ProcessResult } from "../../api/types";
import { Icon } from "../../components/ui/Icon";
import { formatCount, formatRub } from "../../lib/format";

interface InfraCardProps {
  lines: readonly InfraLine[];
  processes: readonly ProcessResult[];
}

/** Self-hosted модели: фиксированная плата за GPU делится между процессами, которые на них работают. */
export function InfraCard({ lines, processes }: InfraCardProps) {
  const names = new Map(processes.map((process) => [process.id, process.name]));
  const total = lines.reduce((sum, line) => sum + line.fixed_rub_month, 0);
  return (
    <section className="card infra" aria-labelledby="infra-title">
      <header className="card__header">
        <h3 id="infra-title" className="card__title">
          <Icon name="server" size={18} /> Собственная инфраструктура
        </h3>
        <span className="muted num">{formatRub(total)} в месяц</span>
      </header>
      <ul className="infra__list">
        {lines.map((line) => (
          <li key={line.model_id} className="infra__item">
            <div>
              <strong>{line.name}</strong>
              <p className="muted small">
                Узлов: {line.units} · общая нагрузка для{" "}
                {formatCount(line.process_ids.length, "процесса", "процессов", "процессов")}:{" "}
                {line.process_ids.map((id) => names.get(id) ?? id).join(", ")}
              </p>
            </div>
            <span className="num infra__cost">{formatRub(line.fixed_rub_month)}/мес</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
