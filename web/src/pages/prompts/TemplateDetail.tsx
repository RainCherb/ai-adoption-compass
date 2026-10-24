import { useMemo, useState } from "react";
import { renderPrompt } from "../../api/client";
import type { PromptTemplate, PromptVariable } from "../../api/types";
import { ScoreRing } from "../../components/charts/ScoreRing";
import { Badge } from "../../components/ui/Badge";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { CopyButton } from "../../components/ui/CopyButton";
import { Field } from "../../components/ui/Field";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { useDebounced } from "../../hooks/useDebounced";
import { labelOf, useMeta } from "../../hooks/useMeta";
import { SensitiveChips } from "./LintResultView";

type Values = Record<string, string>;

const initialValues = (template: PromptTemplate): Values =>
  Object.fromEntries(template.variables.map((variable) => [variable.name, variable.default ?? variable.choices?.[0] ?? ""]));

/** Обязательные поля без значения и без значения по умолчанию на сервере: рендер невозможен. */
const missingFields = (template: PromptTemplate, values: Values): PromptVariable[] =>
  template.variables.filter((variable) => variable.required && variable.default == null && !(values[variable.name] ?? "").trim());

function VariableField({ variable, value, onChange }: { variable: PromptVariable; value: string; onChange: (value: string) => void }) {
  const hint = variable.default != null && variable.type !== "choice" ? `Если оставить пустым: «${variable.default}»` : undefined;
  return (
    <Field
      label={
        <>
          {variable.label}
          {variable.required ? <span className="required" aria-hidden="true"> *</span> : <span className="muted small"> (необязательно)</span>}
        </>
      }
      hint={hint}
    >
      {(control) =>
        variable.type === "text" ? (
          <textarea {...control} className="textarea" rows={4} value={value} onChange={(event) => onChange(event.target.value)} />
        ) : variable.type === "choice" ? (
          <select {...control} className="select" value={value} onChange={(event) => onChange(event.target.value)}>
            {(variable.choices ?? []).map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        ) : (
          <input {...control} className="input" type="text" value={value} onChange={(event) => onChange(event.target.value)} />
        )
      }
    </Field>
  );
}

export function TemplateDetail({ template }: { template: PromptTemplate }) {
  const meta = useMeta();
  const [values, setValues] = useState<Values>(() => initialValues(template));
  const settled = useDebounced(values, 300);
  const missing = useMemo(() => missingFields(template, settled), [template, settled]);
  const liveMissing = useMemo(() => missingFields(template, values), [template, values]);

  const rendered = useAsync(
    missing.length === 0 ? (signal) => renderPrompt(template.id, settled, signal) : null,
    `${template.id}:${JSON.stringify(settled)}`,
  );
  const result = rendered.data;

  const fillExamples = () =>
    setValues((previous) =>
      Object.fromEntries(template.variables.map((variable) => [variable.name, variable.example ?? previous[variable.name] ?? ""])),
    );

  return (
    <article className="tpl-detail" aria-labelledby="tpl-title">
      <header className="tpl-detail__head">
        <div>
          <h2 id="tpl-title" className="tpl-detail__title">
            {template.title}
          </h2>
          <p className="muted">{template.description}</p>
        </div>
        <div className="tpl-detail__badges">
          <Badge tone="neutral">{template.department}</Badge>
          <Badge tone="info">{labelOf(meta.task_types, template.task_type)}</Badge>
          <Badge tone={template.sensitivity === "public" || template.sensitivity === "internal" ? "success" : "warning"}>
            {labelOf(meta.sensitivities, template.sensitivity)}
          </Badge>
        </div>
      </header>

      <div className="tpl-detail__grid">
        <form className="card" onSubmit={(event) => event.preventDefault()} aria-label="Значения переменных">
          <div className="card__header">
            <h3 className="card__title">Переменные</h3>
            <Button size="sm" icon="sparkles" onClick={fillExamples}>
              Подставить пример
            </Button>
          </div>
          {template.variables.map((variable) => (
            <VariableField
              key={variable.name}
              variable={variable}
              value={values[variable.name] ?? ""}
              onChange={(value) => setValues((previous) => ({ ...previous, [variable.name]: value }))}
            />
          ))}
        </form>

        <section className="card" aria-labelledby="tpl-result-title" aria-busy={rendered.loading}>
          <div className="card__header">
            <h3 id="tpl-result-title" className="card__title">
              Готовый промпт
            </h3>
            <CopyButton text={result?.text ?? ""} />
          </div>

          {liveMissing.length > 0 ? (
            <Banner
              tone="info"
              title="Заполните обязательные поля"
              actions={
                <Button size="sm" icon="sparkles" onClick={fillExamples}>
                  Попробовать на примере
                </Button>
              }
            >
              {liveMissing.map((variable) => variable.label).join(", ")}
            </Banner>
          ) : null}
          {rendered.error ? <ErrorBanner error={rendered.error} onRetry={rendered.reload} title="Не удалось собрать промпт" /> : null}
          {rendered.loading && !result ? (
            <LoadingRegion label="Собираем промпт…">
              <Skeleton height={200} radius={8} />
            </LoadingRegion>
          ) : null}

          {result ? (
            <div className={rendered.loading || liveMissing.length > 0 ? "is-refreshing" : undefined}>
              <div className="render-summary">
                <ScoreRing value={result.lint_score} label="Оценка качества промпта" size={64} caption="качество" />
                <div className="render-summary__text">
                  <p className="muted small">Оценка линтера: насколько хорошо составлен запрос (роль, формат, ограничения).</p>
                  <SensitiveChips counts={result.sensitive} />
                </div>
              </div>
              {result.warnings.map((warning) => (
                <Banner key={warning} tone="warning">
                  {warning}
                </Banner>
              ))}
              <pre className="output__text" data-testid="rendered-prompt">
                {result.text}
              </pre>
            </div>
          ) : null}
        </section>
      </div>

      {result && (result.checklist.length > 0 || result.safety_notes.length > 0) ? (
        <div className="tpl-detail__notes">
          {result.checklist.length > 0 ? (
            <section className="card" aria-labelledby="tpl-checklist">
              <h3 id="tpl-checklist" className="card__title">
                Как проверить ответ
              </h3>
              <ul className="checklist">
                {result.checklist.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.safety_notes.length > 0 ? (
            <section className="card" aria-labelledby="tpl-safety">
              <h3 id="tpl-safety" className="card__title">
                Безопасность
              </h3>
              <ul className="notes">
                {result.safety_notes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
