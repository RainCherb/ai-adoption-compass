import { getCatalog } from "../../api/client";
import type { TaskType } from "../../api/types";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { CopyButton } from "../../components/ui/CopyButton";
import { Disclosure } from "../../components/ui/Disclosure";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { useMeta } from "../../hooks/useMeta";

export const CLI_SNIPPET = [
  "# ключ API берётся из переменной окружения OPENAI_API_KEY",
  "compass eval run -p baseline -p api --base-url https://… --model … --catalog-id …",
].join("\n");

export function EvalsPage() {
  return (
    <>
      <PageHeader
        title="Качество API-моделей"
        lead="Одна экспертная матрица Sonnet 5.5, GPT‑6.1 Sol и DeepSeek V4.1 Flash для подбора и ROI. Локальные модели в сравнении не участвуют."
      />
      <Banner tone="info" title="Экспертные оценки, а не измеренная точность">
        Для этих трёх API собственный тест качества ещё не проводился. Оценки
        1–5 помогают изучить подбор; они не являются accuracy, F1 или гарантией
        результата.
      </Banner>
      <PrimaryQuality />
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

function PrimaryQuality() {
  const meta = useMeta();
  const catalog = useAsync((signal) => getCatalog(signal), "primary-quality");
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
  return (
    <section className="stack" aria-label="Экспертная матрица базовых моделей">
      <h2>Качество по девяти типам задач</h2>
      <p className="muted">
        1 — низкое ожидаемое качество, 5 — высокое. Это относительные
        предположения для учебных бизнес-задач на русском языке. Значения
        хранятся в каталоге и не меняются из-за успешной загрузки тарифа. Перед
        внедрением нужен собственный размеченный набор.
      </p>
      <div
        className="table-wrap"
        tabIndex={0}
        role="region"
        aria-label="Оценки качества по типам задач"
      >
        <table className="table">
          <thead>
            <tr>
              <th>Тип задачи</th>
              {models.map((model) => (
                <th key={model.id}>
                  {model.name}
                  <div className="small muted">экспертно, 1–5</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {meta.task_types.map((task) => (
              <tr key={task.value}>
                <th scope="row">{task.label}</th>
                {models.map((model) => (
                  <td key={model.id}>
                    <span
                      className="quality-cell"
                      data-quality={model.quality[task.value as TaskType]}
                    >
                      {model.quality[task.value as TaskType]} / 5
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Приоритет «Качество» учитывает эти оценки; приоритет «Стоимость» может
        выбрать более дешёвую модель, если она проходит минимальный порог.{" "}
        <a href="#/advisor">Проверить подбор →</a>
      </p>
    </section>
  );
}
