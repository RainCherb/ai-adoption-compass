import { useState } from "react";
import { assess, createAssessment, exportUrl, reportUrl } from "../../api/client";
import type { Assumptions, AssessmentResult, StoredAssessment } from "../../api/types";
import { QuadrantChart } from "../../components/charts/QuadrantChart";
import { Badge } from "../../components/ui/Badge";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button, LinkButton } from "../../components/ui/Button";
import { useAction } from "../../hooks/useAction";
import { labelOf, useMeta } from "../../hooks/useMeta";
import { formatDateTime } from "../../lib/format";
import { AssumptionsPanel } from "./AssumptionsPanel";
import { InfraCard } from "./InfraCard";
import { KpiGrid } from "./KpiGrid";
import { ProcessDrawer } from "./ProcessDrawer";
import { ProcessTable } from "./ProcessTable";
import { RoadmapWaves } from "./RoadmapWaves";

interface AssessmentViewProps {
  stored: StoredAssessment;
  onSaved: (id: string) => void;
}

interface WhatIf {
  result: AssessmentResult;
  assumptions: Assumptions;
}

/** Открытая оценка: показатели, допущения с пересчётом «что-если», диаграмма, план, таблица и панель процесса. */
export function AssessmentView({ stored, onSaved }: AssessmentViewProps) {
  const meta = useMeta();
  const [whatIf, setWhatIf] = useState<WhatIf | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const recalc = useAction((assumptions: Assumptions) =>
    assess({ name: stored.name, processes: stored.processes, assumptions }),
  );
  const saveCopy = useAction((assumptions: Assumptions) =>
    createAssessment({
      name: `${stored.name} (что-если)`.slice(0, 120),
      processes: stored.processes,
      assumptions,
    }),
  );

  const result = whatIf?.result ?? stored.result;
  const opened = result.processes.find((process) => process.id === openId) ?? null;
  const quadrantLabels = {
    quick_win: labelOf(meta.quadrants, "quick_win"),
    strategic: labelOf(meta.quadrants, "strategic"),
    fill_in: labelOf(meta.quadrants, "fill_in"),
    postpone: labelOf(meta.quadrants, "postpone"),
    blocked: labelOf(meta.quadrants, "blocked"),
  };

  const onRecalculate = async (assumptions: Assumptions) => {
    const next = await recalc.run(assumptions);
    if (next) setWhatIf({ result: next, assumptions });
  };

  const onSaveCopy = async () => {
    if (!whatIf) return;
    const created = await saveCopy.run(whatIf.assumptions);
    if (created) onSaved(created.id);
  };

  return (
    <div className="assessment-view">
      <header className="view-head">
        <div>
          <h2 className="view-head__title">{stored.name}</h2>
          <p className="muted small">
            Создана {formatDateTime(stored.created_at)} · каталог на {result.catalog_as_of}
          </p>
        </div>
        <div className="view-head__actions">
          <LinkButton href={reportUrl(stored.id)} icon="file" size="sm" download>
            Отчёт (.md)
          </LinkButton>
          <LinkButton href={exportUrl(stored.id)} icon="download" size="sm" download>
            Таблица (.csv)
          </LinkButton>
        </div>
      </header>

      {whatIf ? (
        <Banner
          tone="warning"
          title={
            <>
              <Badge tone="warning">что-если, не сохранено</Badge> Показан пересчёт с изменёнными допущениями
            </>
          }
          actions={
            <>
              <Button size="sm" variant="primary" icon="check" disabled={meta.demo_mode} loading={saveCopy.pending} onClick={() => void onSaveCopy()}>
                Сохранить как новую оценку
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setWhatIf(null)}>
                Сбросить
              </Button>
            </>
          }
        >
          Сохранённая оценка не изменилась. Отчёт и CSV строятся по сохранённому расчёту.
        </Banner>
      ) : null}
      {saveCopy.error ? <ErrorBanner error={saveCopy.error} title="Не удалось сохранить оценку" /> : null}

      {result.warnings.length > 0 ? (
        <Banner tone="warning" title={result.warnings.length === 1 ? "Предупреждение" : "Предупреждения"} className="warnings">
          <ul className="banner__list">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Banner>
      ) : null}

      <KpiGrid summary={result.summary} horizon={result.assumptions.horizon_months} />

      <AssumptionsPanel
        baseline={stored.result.assumptions}
        defaults={meta.default_assumptions}
        whatIfActive={whatIf !== null}
        busy={recalc.pending}
        error={recalc.error}
        onRecalculate={(assumptions) => void onRecalculate(assumptions)}
        onReset={() => setWhatIf(null)}
      />

      <div className="dash-grid">
        <section className="card" aria-labelledby="chart-title">
          <header className="card__header">
            <h3 id="chart-title" className="card__title">
              Матрица приоритетов
            </h3>
          </header>
          <QuadrantChart
            processes={result.processes}
            thresholds={{ ease: meta.thresholds["ease"] ?? 50, impact: meta.thresholds["impact"] ?? 50 }}
            quadrantLabels={quadrantLabels}
            selectedId={openId}
            onSelect={setOpenId}
          />
        </section>

        <section className="card" aria-labelledby="roadmap-title">
          <header className="card__header">
            <h3 id="roadmap-title" className="card__title">
              План внедрения
            </h3>
          </header>
          <RoadmapWaves waves={result.roadmap} processes={result.processes} onOpen={setOpenId} />
        </section>
      </div>

      {result.summary.infrastructure.length > 0 ? (
        <InfraCard lines={result.summary.infrastructure} processes={result.processes} />
      ) : null}

      <section className="card card--flush" aria-labelledby="table-title">
        <header className="card__header">
          <h3 id="table-title" className="card__title">
            Все процессы
          </h3>
        </header>
        <ProcessTable
          processes={result.processes}
          quadrants={meta.quadrants}
          horizonMonths={result.assumptions.horizon_months}
          selectedId={openId}
          onOpen={setOpenId}
        />
      </section>

      {opened ? (
        <ProcessDrawer
          process={opened}
          assumptions={result.assumptions}
          infra={result.summary.infrastructure}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  );
}
