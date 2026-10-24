import type { Assumptions, InfraLine, ProcessResult } from "../../api/types";
import { ScoreBar } from "../../components/charts/ScoreBar";
import { Banner } from "../../components/ui/Banner";
import { Badge } from "../../components/ui/Badge";
import { Drawer } from "../../components/ui/Drawer";
import { labelOf, useMeta } from "../../hooks/useMeta";
import { formatCount, formatNumber, formatRub } from "../../lib/format";
import { FlagList } from "./FlagList";
import { ModelCard } from "./ModelCard";
import { MoneySteps } from "./MoneySteps";
import { QuadrantBadge } from "./QuadrantBadge";
import { ScenarioTable } from "./ScenarioTable";
import { ModelOptionsTable } from "../advisor/ModelOptionsTable";

interface ProcessDrawerProps {
  process: ProcessResult;
  assumptions: Assumptions;
  infra: readonly InfraLine[];
  onClose: () => void;
}

export function ProcessDrawer({ process, assumptions, infra, onClose }: ProcessDrawerProps) {
  const meta = useMeta();
  const sharedInfra = infra.find((line) => line.process_ids.includes(process.id));

  return (
    <Drawer
      title={process.name}
      onClose={onClose}
      subtitle={
        <span className="drawer__meta">
          <span className="num muted">№{process.rank}</span>
          <span>{process.department}</span>
          <span className="muted">{labelOf(meta.task_types, process.task_type)}</span>
          <QuadrantBadge quadrant={process.quadrant} label={labelOf(meta.quadrants, process.quadrant)} />
          {process.wave ? <Badge tone="neutral">Волна {process.wave}</Badge> : null}
        </span>
      }
    >
      {process.model === null ? (
        <Banner tone="danger" title="Расчёт эффекта не выполнен">
          Нет модели, которая проходит политику данных и требования к качеству. Потенциал экономии времени —{" "}
          {formatNumber(process.hours_saved_month, 1)} ч/мес, но без допустимой модели он недостижим.
        </Banner>
      ) : (
        <>
          <section className="drawer-section" aria-labelledby="drawer-money">
            <h3 id="drawer-money" className="drawer-section__title">
              Расчёт по шагам
            </h3>
            <MoneySteps process={process} assumptions={assumptions} />
          </section>

          <section className="drawer-section" aria-labelledby="drawer-scenarios">
            <h3 id="drawer-scenarios" className="drawer-section__title">
              Сценарии
            </h3>
            {process.scenarios.length > 0 ? (
              <ScenarioTable scenarios={process.scenarios} />
            ) : (
              <p className="muted">Для этого процесса сценарии не рассчитывались.</p>
            )}
          </section>

          <section className="drawer-section" aria-labelledby="drawer-model">
            <h3 id="drawer-model" className="drawer-section__title">
              Выбранная модель
            </h3>
            <ModelCard model={process.model} />
            {sharedInfra ? (
              <p className="muted small">
                Фиксированная часть — доля общей инфраструктуры «{sharedInfra.name}»: {formatRub(sharedInfra.fixed_rub_month)}/мес
                на {formatCount(sharedInfra.process_ids.length, "процесс", "процесса", "процессов")}.
              </p>
            ) : null}
          </section>
        </>
      )}

      <ModelOptionsTable items={process.model_options ?? []} />
      <section className="drawer-section" aria-labelledby="drawer-flags">
        <h3 id="drawer-flags" className="drawer-section__title">
          Флаги и риски
        </h3>
        <FlagList flags={process.flags} />
      </section>

      <section className="drawer-section" aria-labelledby="drawer-scores">
        <h3 id="drawer-scores" className="drawer-section__title">
          Оценки
        </h3>
        <div className="score-bars">
          <ScoreBar label="Пригодность для ИИ" value={process.fit} hint="fit: насколько задача подходит для автоматизации" />
          <ScoreBar label="Эффект" value={process.impact} hint="impact: масштаб денежного эффекта" />
          <ScoreBar label="Лёгкость внедрения" value={process.ease} hint="ease: готовность данных, стандартизация, риск" />
          <ScoreBar label="Приоритет" value={process.priority} hint="priority: итоговая оценка для очереди внедрения" />
        </div>
      </section>
    </Drawer>
  );
}
