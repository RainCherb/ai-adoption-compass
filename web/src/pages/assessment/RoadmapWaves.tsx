import type { ProcessResult, RoadmapWave } from "../../api/types";
import { formatHours, formatRub, formatRubCompact } from "../../lib/format";

interface RoadmapWavesProps {
  waves: readonly RoadmapWave[];
  processes: readonly ProcessResult[];
  onOpen: (id: string) => void;
}

export function RoadmapWaves({ waves, processes, onOpen }: RoadmapWavesProps) {
  const byId = new Map(processes.map((process) => [process.id, process]));

  if (waves.length === 0) {
    return <p className="muted">План внедрения пуст: ни один процесс не прошёл отбор.</p>;
  }

  return (
    <ol className="waves">
      {waves.map((wave) => (
        <li key={wave.wave} className="wave" data-wave={wave.wave} data-testid="roadmap-wave">
          <div className="wave__head">
            <span className="wave__number" aria-hidden="true">
              {wave.wave}
            </span>
            <h4 className="wave__title">{wave.title}</h4>
          </div>
          <ul className="wave__chips" aria-label="Процессы волны">
            {wave.process_ids.map((id) => (
              <li key={id}>
                <button type="button" className="process-chip" onClick={() => onOpen(id)}>
                  {byId.get(id)?.name ?? id}
                </button>
              </li>
            ))}
          </ul>
          <dl className="wave__totals">
            <div>
              <dt>Экономия</dt>
              <dd className="num">{formatHours(wave.hours_saved_month, 0)}/мес</dd>
            </div>
            <div>
              <dt>Внедрение</dt>
              <dd className="num" title={formatRub(wave.implementation_rub)}>
                {formatRubCompact(wave.implementation_rub)}
              </dd>
            </div>
            <div>
              <dt>Эффект за период</dt>
              <dd className="num" title={formatRub(wave.net_horizon_rub)}>
                {formatRubCompact(wave.net_horizon_rub)}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ol>
  );
}
