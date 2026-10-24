import { useRef, useState } from "react";
import { compareFeaturedModels } from "../../api/client";
import type { ModelComparisonRequest } from "../../api/types";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { Field } from "../../components/ui/Field";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, SkeletonCards } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { formatDate, formatNumber } from "../../lib/format";

export const DEFAULT_COMPARISON: ModelComparisonRequest = {
  requests_per_month: 10000,
  tokens_in: 1000,
  tokens_out: 300,
  deepseek_period: "peak",
};

const usd = (value: number | null | undefined, precision?: number) =>
  value == null
    ? "—"
    : `${formatNumber(value, precision ?? (value > 0 && value < 0.01 ? 6 : 2))} $`;

export function ModelsPage() {
  const calculator = useRef<HTMLDetailsElement>(null);
  const [workload, setWorkload] = useState(DEFAULT_COMPARISON);
  const [draft, setDraft] = useState({
    requests: "10000",
    input: "1000",
    output: "300",
    period: "peak",
  });
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const comparison = useAsync(
    (signal) => compareFeaturedModels(workload, signal),
    JSON.stringify(workload),
  );
  const patch = (key: keyof typeof draft, value: string) => {
    setDraft({ ...draft, [key]: value });
    setDirty(true);
  };

  return (
    <>
      <PageHeader
        title="Зарубежные модели"
        lead="Claude Sonnet 5.5, GPT‑6.1 Sol и DeepSeek V4.1 Flash — прямые API, проверяемые тарифы и одна нагрузка для сравнения стоимости."
      />
      <p className="muted">
        Порядок 01 → 02 → 03 — акцент демо, а не рейтинг качества.
      </p>

      {dirty ? (
        <p role="status">
          Параметры изменены. Нажмите «Сравнить стоимость»; ниже пока показан
          предыдущий расчёт.
        </p>
      ) : null}
      {comparison.error ? (
        <ErrorBanner
          error={comparison.error}
          onRetry={comparison.reload}
          title="Не удалось получить тарифы"
        />
      ) : null}
      {comparison.loading ? (
        <LoadingRegion label="Рассчитываем стоимость…">
          <SkeletonCards count={3} />
        </LoadingRegion>
      ) : null}
      {comparison.data ? (
        <div className="stack" aria-busy={comparison.loading}>
          <div className="button-row model-focus__workload">
            <p className="muted small">
              Расчёт:{" "}
              {formatNumber(comparison.data.workload.requests_per_month)}{" "}
              запросов/мес. × {formatNumber(comparison.data.workload.tokens_in)}{" "}
              входных + {formatNumber(comparison.data.workload.tokens_out)}{" "}
              выходных токенов. USD; текст, без кэша.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                if (calculator.current) {
                  calculator.current.open = true;
                  calculator.current.scrollIntoView?.({ block: "center" });
                }
              }}
            >
              Изменить нагрузку
            </Button>
          </div>
          <ol
            className="model-focus__profiles"
            aria-label="Основные зарубежные модели"
          >
            {comparison.data.models.map((row, index) => (
              <li className="model-focus__profile" key={row.model.id}>
                <span className="model-focus__index">
                  0{index + 1} / {row.model.vendor}
                </span>
                <h2>{row.model.name}</h2>
                <p className="muted">{row.model.summary}</p>
                <div className="model-focus__amount">
                  {usd(row.monthly_usd)}
                  <span>/ месяц</span>
                </div>
                <p className="small">{row.tariff}</p>
                {!row.available ? (
                  <p role="status" className="field__error">
                    {row.reason}
                  </p>
                ) : (
                  <dl className="model-focus__facts">
                    <div>
                      <dt>Вход / 1 млн</dt>
                      <dd>{usd(row.input_rate)}</dd>
                    </div>
                    <div>
                      <dt>Выход / 1 млн</dt>
                      <dd>{usd(row.output_rate)}</dd>
                    </div>
                    <div>
                      <dt>За запрос</dt>
                      <dd>{usd(row.per_request_usd, 6)}</dd>
                    </div>
                    <div>
                      <dt>Вход за месяц</dt>
                      <dd>{usd(row.input_usd)}</dd>
                    </div>
                    <div>
                      <dt>Выход за месяц</dt>
                      <dd>{usd(row.output_usd)}</dd>
                    </div>
                  </dl>
                )}
                <dl className="model-focus__facts">
                  <div>
                    <dt>Контекст</dt>
                    <dd>{row.model.context_label}</dd>
                  </div>
                  <div>
                    <dt>Максимальный выход</dt>
                    <dd>{formatNumber(row.model.max_output_tokens)}</dd>
                  </div>
                </dl>
                <p className="small">
                  <code>{row.model.api_model}</code>
                </p>
                <p className="muted small">{row.model.version_note}</p>
                <p className="small">
                  Сверено {formatDate(row.model.reviewed_at)} ·{" "}
                  <a
                    href={row.model.pricing_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Прямой тариф ↗
                  </a>{" "}
                  ·{" "}
                  <a
                    href={row.model.specs_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Лимиты ↗
                  </a>
                </p>
                <details>
                  <summary>Условия цены и доступа</summary>
                  <ul>
                    {row.model.conditions.map((condition) => (
                      <li key={condition}>{condition}</li>
                    ))}
                  </ul>
                  <p>{row.model.access_note}</p>
                  {row.model.access_url ? (
                    <a
                      href={row.model.access_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Официальные регионы API ↗
                    </a>
                  ) : null}
                </details>
              </li>
            ))}
          </ol>
          <details className="card model-focus__calculator" ref={calculator}>
            <summary>Настроить общую нагрузку и период DeepSeek</summary>
            <form
              className="model-focus__form"
              aria-label="Общая нагрузка моделей"
              onSubmit={(event) => {
                event.preventDefault();
                const values = [draft.requests, draft.input, draft.output].map(
                  (v) => (v.trim() === "" ? NaN : Number(v)),
                );
                const [requests, input, output] = values;
                if (
                  values.some((v) => !Number.isInteger(v)) ||
                  requests! < 1 ||
                  requests! > 1e9 ||
                  input! < 1 ||
                  input! > 2e6 ||
                  output! < 0 ||
                  output! > 384000
                ) {
                  setError(
                    "Введите целые числа: запросы 1–1 000 000 000, вход 1–2 000 000, выход 0–384 000.",
                  );
                  return;
                }
                setError(null);
                setDirty(false);
                setWorkload({
                  requests_per_month: requests!,
                  tokens_in: input!,
                  tokens_out: output!,
                  deepseek_period: draft.period as "peak" | "off_peak",
                });
              }}
            >
              <h2 className="card__title">Одна нагрузка для трёх моделей</h2>
              <div className="model-focus__inputs">
                <Field label="Запросов в месяц">
                  {(control) => (
                    <input
                      {...control}
                      className="input"
                      inputMode="numeric"
                      value={draft.requests}
                      onChange={(e) => patch("requests", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Входных токенов на запрос">
                  {(control) => (
                    <input
                      {...control}
                      className="input"
                      inputMode="numeric"
                      value={draft.input}
                      onChange={(e) => patch("input", e.target.value)}
                    />
                  )}
                </Field>
                <Field
                  label="Выходных токенов на запрос"
                  hint="Включая оплачиваемые reasoning-токены"
                >
                  {(control) => (
                    <input
                      {...control}
                      className="input"
                      inputMode="numeric"
                      value={draft.output}
                      onChange={(e) => patch("output", e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Период DeepSeek">
                  {(control) => (
                    <select
                      {...control}
                      className="select"
                      value={draft.period}
                      onChange={(e) => patch("period", e.target.value)}
                    >
                      <option value="peak">Peak — пиковый тариф</option>
                      <option value="off_peak">
                        Off-peak — внепиковый тариф
                      </option>
                    </select>
                  )}
                </Field>
              </div>
              {error ? (
                <p role="alert" className="field__error">
                  {error}
                </p>
              ) : null}
              <div className="button-row">
                <Button type="submit">Сравнить стоимость</Button>
                <a href="#/assessment">Перейти к оценке процессов →</a>
              </div>
            </form>
          </details>
          <Banner tone="info" title="Что означают эти цифры">
            {comparison.data.disclaimer}
          </Banner>
          <Banner
            tone="warning"
            title="Качество основных моделей ещё не измерено в проекте"
          >
            Для этих трёх моделей нет собственного общего теста качества и
            задержек. <a href="#/evals">Сохранённый локальный эксперимент</a>{" "}
            относится к другим, компактным моделям и не переносится на Sonnet,
            GPT или DeepSeek.
          </Banner>
          <p className="muted small">
            Все карточки — зарубежные API. Для персональных данных и закрытых
            документов используйте{" "}
            <a href="#/advisor">подбор по ограничениям</a>. Источники и сроки
            актуальности доступны в разделе «Подбор моделей → Каталог». По
            истечении срока ревью калькулятор скрывает стоимость до повторной
            сверки.
          </p>
        </div>
      ) : null}
    </>
  );
}
