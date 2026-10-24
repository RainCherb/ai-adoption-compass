import { useState } from "react";
import { getCatalog, getEvalDemo, getMeasuredEvals } from "../../api/client";
import type { EvalDemo, TaskType } from "../../api/types";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { CopyButton } from "../../components/ui/CopyButton";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { useMeta } from "../../hooks/useMeta";
import { downloadTextFile } from "../../lib/download";
import { formatCount } from "../../lib/format";
import { ComparisonTable, pickHighlights } from "./ComparisonTable";
import { ProviderDetail } from "./ProviderDetail";

export const CLI_SNIPPET = [
  "# ключ API берётся из переменной окружения OPENAI_API_KEY",
  "compass eval run -p baseline -p api --base-url https://… --model … --catalog-id …",
].join("\n");

export function EvalsPage({ initialMode }: { initialMode?: "measured" | "simulated" }) {
  const meta = useMeta();
  const [mode, setMode] = useState<"expert" | "measured" | "simulated">(initialMode ?? (meta.demo_mode ? "expert" : "measured"));
  const evals = useAsync(mode === "expert" ? null : (signal) => mode === "measured" ? getMeasuredEvals(signal) : getEvalDemo(signal), `evals-${mode}`);
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title="Качество моделей"
        lead="Экспертные оценки Sonnet 5.5, GPT‑6.1 Sol и DeepSeek V4.1 Flash, используемые в подборе и ROI. Реальные измерения и учебная симуляция доступны отдельно."
      />

      <Banner tone="warning" title="Sonnet 5.5, GPT‑6.1 Sol и DeepSeek V4.1 Flash здесь не тестировались">
        Оценки 1–5 — гипотезы для демонстрации выбора и экономики. Они не являются точностью, F1 или результатами собственных замеров. Прежний эксперимент с компактными LLM доступен в «Реальных измерениях».
        <a href="#/advisor"> Подбор основных моделей, оценки и стоимость →</a>
      </Banner>

      <div className="button-row" aria-label="Тип сравнения">
        <Button variant={mode === "expert" ? "primary" : "secondary"} aria-pressed={mode === "expert"} onClick={() => { setSelected(null); setMode("expert"); }}>Экспертные оценки</Button>
        <Button variant={mode === "measured" ? "primary" : "secondary"} aria-pressed={mode === "measured"} onClick={() => { setSelected(null); setMode("measured"); }}>Реальные измерения</Button>
        <Button variant={mode === "simulated" ? "primary" : "secondary"} aria-pressed={mode === "simulated"} onClick={() => { setSelected(null); setMode("simulated"); }}>Симуляция для обучения</Button>
      </div>

      {mode === "expert" ? <PrimaryQuality /> : null}

      {mode !== "expert" && evals.error ? <ErrorBanner error={evals.error} onRetry={evals.reload} title="Не удалось загрузить сравнение" /> : null}
      {mode !== "expert" && evals.loading && !evals.data ? (
        <LoadingRegion label="Считаем сравнение…" className="stack">
          <Skeleton height={64} radius={12} />
          <Skeleton height={260} radius={12} />
        </LoadingRegion>
      ) : null}

      {mode !== "expert" && evals.data ? (
        <EvalsContent
          demo={evals.data}
          selected={selected ?? pickHighlights(evals.data.reports).best ?? evals.data.reports[0]?.provider ?? ""}
          onSelect={setSelected}
        />
      ) : null}
    </>
  );
}

function PrimaryQuality() {
  const meta = useMeta();
  const catalog = useAsync((signal) => getCatalog(signal), "primary-quality");
  if (catalog.error) return <ErrorBanner error={catalog.error} onRetry={catalog.reload} title="Не удалось загрузить экспертные оценки" />;
  if (!catalog.data) return <LoadingRegion label="Загружаем оценки…"><Skeleton height={260} radius={12} /></LoadingRegion>;
  const models = catalog.data.models.filter((model) => model.profile);
  return <section className="stack" aria-label="Экспертная матрица базовых моделей">
    <h2>Одна матрица для подбора и всех процессов</h2>
    <p className="muted">1 — низкое ожидаемое качество, 5 — высокое. Это относительные предположения для учебных бизнес-задач на русском языке. Значения хранятся в каталоге и не меняются из-за успешной загрузки тарифа. Перед внедрением нужен собственный размеченный набор.</p>
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Оценки качества по типам задач"><table className="table">
      <thead><tr><th>Тип задачи</th>{models.map((model) => <th key={model.id}>{model.name}<div className="small muted">экспертно, 1–5</div></th>)}</tr></thead>
      <tbody>{meta.task_types.map((task) => <tr key={task.value}><th scope="row">{task.label}</th>{models.map((model) => <td key={model.id}>{model.quality[task.value as TaskType]} / 5</td>)}</tr>)}</tbody>
    </table></div>
    <p>Приоритет «Качество» учитывает эти оценки; приоритет «Стоимость» может выбрать более дешёвую модель, если она проходит минимальный порог. <a href="#/advisor">Проверить подбор →</a></p>
  </section>;
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
