import { useState } from "react";
import { getEvalDemo, getMeasuredEvals } from "../../api/client";
import type { EvalDemo } from "../../api/types";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { CopyButton } from "../../components/ui/CopyButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { downloadTextFile } from "../../lib/download";
import { formatCount } from "../../lib/format";
import { ComparisonTable, pickHighlights } from "./ComparisonTable";
import { ProviderDetail } from "./ProviderDetail";

export const CLI_SNIPPET = [
  "# ключ API берётся из переменной окружения OPENAI_API_KEY",
  "compass eval run -p baseline -p api --base-url https://… --model … --catalog-id …",
].join("\n");

export function EvalsPage({ initialMode = "measured" }: { initialMode?: "measured" | "simulated" }) {
  const [mode, setMode] = useState(initialMode);
  const evals = useAsync((signal) => mode === "measured" ? getMeasuredEvals(signal) : getEvalDemo(signal), `evals-${mode}`);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Качество моделей"
        lead="Сравнение моделей на размеченном наборе: точность, задержка и стоимость. Решение о модели принимают по цифрам на своих данных, а не по рекламе."
      />

      <div className="button-row" aria-label="Тип сравнения">
        <Button variant={mode === "measured" ? "primary" : "secondary"} aria-pressed={mode === "measured"} onClick={() => { setSelected(null); setMode("measured"); }}>Реальные измерения</Button>
        <Button variant={mode === "simulated" ? "primary" : "secondary"} aria-pressed={mode === "simulated"} onClick={() => { setSelected(null); setMode("simulated"); }}>Симуляция для обучения</Button>
      </div>

      {evals.error ? <ErrorBanner error={evals.error} onRetry={evals.reload} title="Не удалось загрузить сравнение" /> : null}
      {evals.loading && !evals.data ? (
        <LoadingRegion label="Считаем сравнение…" className="stack">
          <Skeleton height={64} radius={12} />
          <Skeleton height={260} radius={12} />
        </LoadingRegion>
      ) : null}

      {evals.data ? (
        <EvalsContent
          demo={evals.data}
          selected={selected ?? pickHighlights(evals.data.reports).best ?? evals.data.reports[0]?.provider ?? ""}
          onSelect={setSelected}
        />
      ) : null}
    </>
  );
}

function EvalsContent({
  demo,
  selected,
  onSelect,
}: {
  demo: EvalDemo;
  selected: string;
  onSelect: (provider: string) => void;
}) {
  const report = demo.reports.find((item) => item.provider === selected);

  return (
    <div className="stack">
      {demo.kind === "measured" ? <Banner tone="info" title="Измерено на настоящих локальных LLM — без платных API">
        72 одинаковых синтетических обращения, 8 категорий, один прогон трёх компактных моделей на CPU.
        Ответы получены от LLM, а не симулятора. Бесплатный API-счёт не означает нулевую стоимость оборудования.
        Задержки зависят от машины; этот набор не является независимой оценкой всех бизнес-задач.
      </Banner> : <Banner tone="info" title="Это демонстрационный прогон, а не замер реальных моделей">
        Строки <code>sim:*</code> — детерминированная симуляция: ответы «моделей» генерируются по фиксированному правилу, чтобы
        интерфейс и метрики можно было показать без ключей API. <code>baseline:keywords</code> — простая базовая линия на
        ключевых словах: любая модель должна быть лучше неё, иначе она не стоит своих денег.
      </Banner>}

      {demo.provenance ? <section className="card" aria-label="Происхождение измерений">
        <h2 className="card__title">Воспроизводимость и ограничения</h2>
        <p className="muted small">Дата: {String(demo.provenance["created_at"])} · SHA-256 набора: <code className="fingerprint">{String(demo.provenance["dataset_sha256"])}</code></p>
        <details><summary>Методика, оборудование и ограничения</summary><ul>{Array.isArray(demo.provenance["limitations"]) ? demo.provenance["limitations"].map((note) => <li key={String(note)}>{String(note)}</li>) : null}</ul></details>
        <a href="https://github.com/RainCherb/ai-adoption-compass/blob/main/src/adoption_compass/data/evals/measured.json" target="_blank" rel="noreferrer">Полный артефакт: ответы, версии весов, хеши, параметры и метрики</a>
      </section> : null}

      <section className="card" aria-labelledby="eval-task-title">
        <header className="card__header">
          <div>
            <h2 id="eval-task-title" className="card__title">
              {demo.task.title}
            </h2>
            <p className="muted small">
              Набор: {formatCount(demo.task.items, "пример", "примера", "примеров")} · классов: {demo.task.labels.length}
            </p>
          </div>
          <Button
            size="sm"
            icon="download"
            onClick={() => downloadTextFile("eval-report.md", demo.markdown)}
          >
            Отчёт (.md)
          </Button>
        </header>
        <p>{demo.task.description}</p>
      </section>

      <section className="card" aria-labelledby="eval-compare-title">
        <h2 id="eval-compare-title" className="card__title">
          Сравнение
        </h2>
        <ComparisonTable reports={demo.reports} selected={selected} onSelect={onSelect} />
        <p className="muted small">Нажмите на строку, чтобы увидеть матрицу ошибок и примеры промахов.</p>
      </section>

      {report ? <ProviderDetail report={report} task={demo.task} /> : null}

      <section className="card" aria-labelledby="eval-cli-title">
        <header className="card__header">
          <h2 id="eval-cli-title" className="card__title">
            Прогон на реальных моделях
          </h2>
          <CopyButton text={CLI_SNIPPET} />
        </header>
        <p className="muted small">
          Замените <code>…</code> на адрес OpenAI-совместимого API, имя модели и идентификатор записи каталога (оттуда берутся цены).
        </p>
        <pre className="output__text code-block" data-testid="cli-snippet">
          {CLI_SNIPPET}
        </pre>
      </section>
    </div>
  );
}
