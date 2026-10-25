import { getCatalog } from "../../api/client";
import type { Deployment, TaskType } from "../../api/types";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { CopyButton } from "../../components/ui/CopyButton";
import { Disclosure } from "../../components/ui/Disclosure";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { labelOf, useMeta } from "../../hooks/useMeta";

/** Короткие заголовки столбцов матрицы; полное название типа задачи — во всплывающей подсказке. */
const TASK_SHORT_LABELS: Record<TaskType, string> = {
  classification: "Классиф.",
  extraction: "Извлечение",
  summarization: "Резюме",
  drafting: "Тексты",
  qa_search: "База знаний",
  translation: "Перевод",
  analysis: "Анализ",
  code: "Код",
  decision_support: "Решения",
};

const MODEL_GROUPS: readonly { deployment: Deployment; title: string }[] = [
  { deployment: "ru_cloud", title: "Российские облака" },
  { deployment: "foreign_cloud", title: "Зарубежные API" },
];

export const CLI_SNIPPET = [
  "# ключ API берётся из переменной окружения OPENAI_API_KEY",
  "compass eval run -p baseline -p api --base-url https://… --model … --catalog-id …",
].join("\n");

export function EvalsPage() {
  return (
    <>
      <PageHeader
        title="Качество API-моделей"
        lead="Экспертная матрица качества 11 моделей — российских и зарубежных — для подбора и ROI."
      />
      <Banner tone="info" title="Экспертные оценки, а не измеренная точность">
        Собственный тест качества на ваших данных ещё не проводился. Оценки 1–5
        помогают сравнить модели при подборе; они не являются accuracy, F1 или
        гарантией результата.
      </Banner>
      <QualityMatrix />
      <section className="card stack" aria-label="План проверки API">
        <h2 className="card__title">Как подтвердить выбор на API</h2>
        <ol className="pilot-steps">
          <li>
            <strong>Одинаковые задачи.</strong> Подготовьте обезличенные примеры
            и ожидаемый результат для своего процесса.
          </li>
          <li>
            <strong>Одинаковые условия.</strong> Зафиксируйте API ID, версию,
            промпт, параметры и допустимую длину ответа. Модели сравниваются на
            одном наборе.
          </li>
          <li>
            <strong>Качество и деньги.</strong> Считайте долю правильных
            ответов, ручные исправления, задержки p50/p95 и стоимость успешного
            результата по фактическому usage.
          </li>
          <li>
            <strong>Решение после пилота.</strong> Сравните результаты с
            экспертными предположениями и обновите допущения ROI.
          </li>
        </ol>
        <p className="muted small">
          Интерактивное демо не отправляет запросы LLM и не списывает деньги.
          Пилот требует собственного разрешённого API-доступа; цена из
          калькулятора не подтверждает доступность модели в России.
        </p>
        <Disclosure title="Команда для OpenAI-совместимого API">
          <CopyButton text={CLI_SNIPPET} />
          <pre className="output__text code-block" data-testid="cli-snippet">
            {CLI_SNIPPET}
          </pre>
          <p className="muted small">
            Для нативного Claude Messages API нужен совместимый адаптер. Команда
            не запускается из браузера.
          </p>
        </Disclosure>
      </section>
    </>
  );
}

function QualityMatrix() {
  const meta = useMeta();
  const catalog = useAsync((signal) => getCatalog(signal), "quality-matrix");
  if (catalog.error)
    return (
      <ErrorBanner
        error={catalog.error}
        onRetry={catalog.reload}
        title="Не удалось загрузить экспертные оценки"
      />
    );
  if (!catalog.data)
    return (
      <LoadingRegion label="Загружаем оценки…">
        <Skeleton height={260} radius={12} />
      </LoadingRegion>
    );
  const models = catalog.data.models.filter((model) => model.profile);
  const columns = meta.task_types;
  return (
    <section className="stack" aria-label="Экспертная матрица качества моделей">
      <h2>Качество моделей по типам задач</h2>
      <p className="muted">
        1 — низкое ожидаемое качество, 5 — высокое. Это относительные
        экспертные предположения для типовых бизнес-задач на русском языке;
        они хранятся в каталоге и не меняются при обновлении тарифов. Перед
        внедрением нужен собственный размеченный набор.
      </p>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Оценки качества по типам задач"
      >
        <table className="table quality-matrix" data-testid="quality-matrix">
          <caption className="visually-hidden">
            Экспертные оценки качества моделей от 1 до 5 по типам задач
          </caption>
          <thead>
            <tr>
              <th scope="col">Модель</th>
              {columns.map((task) => (
                <th key={task.value} scope="col">
                  <abbr title={task.label}>
                    {TASK_SHORT_LABELS[task.value as TaskType] ?? task.label}
                  </abbr>
                </th>
              ))}
            </tr>
          </thead>
          {MODEL_GROUPS.map((group) => {
            const rows = models.filter(
              (model) => model.deployment === group.deployment,
            );
            if (rows.length === 0) return null;
            return (
              <tbody key={group.deployment}>
                <tr>
                  <th
                    scope="rowgroup"
                    colSpan={columns.length + 1}
                    className="quality-matrix__group"
                  >
                    {group.title}
                  </th>
                </tr>
                {rows.map((model) => (
                  <tr key={model.id}>
                    <th scope="row">
                      {model.name}
                      <span className="quality-matrix__vendor">
                        {model.vendor}
                      </span>
                    </th>
                    {columns.map((task) => {
                      const quality = model.quality[task.value as TaskType];
                      return (
                        <td key={task.value}>
                          <span className="quality-cell" data-quality={quality}>
                            {quality}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>
      </div>
      <p>
        Приоритет «{labelOf(meta.preferences, "quality")}» опирается на эти
        оценки; приоритет «{labelOf(meta.preferences, "cost")}» может выбрать
        более дешёвую модель, если она проходит минимальный порог качества.{" "}
        <a href="#/advisor">Проверить подбор →</a>
      </p>
    </section>
  );
}
