import type { ReactNode } from "react";
import type { Preference, Sensitivity, TaskType } from "../../api/types";
import { Field } from "../../components/ui/Field";
import { useMeta } from "../../hooks/useMeta";
import { formatNumber } from "../../lib/format";
import { type AdvisorFormState, type FieldErrors, applyTaskType } from "./workload";

interface AdvisorFormProps {
  form: AdvisorFormState;
  errors: FieldErrors;
  onChange: (next: AdvisorFormState) => void;
}

const QUALITY_HINTS: Record<number, string> = {
  1: "черновики, ошибки не критичны",
  2: "простые задачи с проверкой человеком",
  3: "типовые бизнес-задачи",
  4: "ответственные задачи, мало правок",
  5: "максимальная точность и рассуждения",
};

function Check({ checked, onChange, children }: { checked: boolean; onChange: (value: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

export function AdvisorForm({ form, errors, onChange }: AdvisorFormProps) {
  const meta = useMeta();
  const patch = (changes: Partial<AdvisorFormState>) => onChange({ ...form, ...changes });
  const tokensPerMonth =
    Number(form.requests_per_month.replace(/\s/g, "")) * (Number(form.tokens_in.replace(/\s/g, "")) + Number(form.tokens_out.replace(/\s/g, "")));

  return (
    <form className="card advisor-form" onSubmit={(event) => event.preventDefault()} noValidate aria-label="Параметры задачи">
      <h2 className="card__title">Параметры задачи</h2>

      <Field label="Тип задачи" hint="При смене подставляются типичные токены и минимальное качество">
        {(control) => (
          <select
            {...control}
            className="select"
            value={form.task_type}
            onChange={(event) => onChange(applyTaskType(form, event.target.value as TaskType, meta))}
          >
            {meta.task_types.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <fieldset className="fieldset">
        <legend className="field__label">Категория данных</legend>
        <div className="radio-cards">
          {meta.sensitivities.map((item) => (
            <label key={item.value} className="radio-card">
              <input
                type="radio"
                name="data_sensitivity"
                value={item.value}
                checked={form.data_sensitivity === item.value}
                onChange={() => patch({ data_sensitivity: item.value as Sensitivity })}
              />
              <span className="radio-card__body">
                <span className="radio-card__title">{item.label}</span>
                <span className="radio-card__desc">{item.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Запросов в месяц" error={errors.requests_per_month}>
        {(control) => (
          <input
            {...control}
            className="input num"
            type="text"
            inputMode="numeric"
            value={form.requests_per_month}
            onChange={(event) => patch({ requests_per_month: event.target.value })}
          />
        )}
      </Field>

      <div className="field-row">
        <Field label="Токенов на входе" error={errors.tokens_in}>
          {(control) => (
            <input
              {...control}
              className="input num"
              type="text"
              inputMode="numeric"
              value={form.tokens_in}
              onChange={(event) => patch({ tokens_in: event.target.value })}
            />
          )}
        </Field>
        <Field label="Токенов на выходе" error={errors.tokens_out}>
          {(control) => (
            <input
              {...control}
              className="input num"
              type="text"
              inputMode="numeric"
              value={form.tokens_out}
              onChange={(event) => patch({ tokens_out: event.target.value })}
            />
          )}
        </Field>
      </div>
      {Number.isFinite(tokensPerMonth) && tokensPerMonth > 0 ? (
        <p className="field__hint">≈ {formatNumber(tokensPerMonth / 1e6, 2)} млн токенов в месяц</p>
      ) : null}

      <fieldset className="fieldset">
        <legend className="field__label">Минимальное качество (1–5)</legend>
        <div className="segmented" role="radiogroup" aria-label="Минимальное качество">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="segmented__item">
              <input
                type="radio"
                name="min_quality"
                value={value}
                checked={form.min_quality === value}
                onChange={() => patch({ min_quality: value })}
              />
              <span>{value}</span>
            </label>
          ))}
        </div>
        <p className="field__hint">{QUALITY_HINTS[form.min_quality]}</p>
      </fieldset>

      <Field label="Бюджет в месяц, ₽ (необязательно)" hint="Модели дороже бюджета будут исключены" error={errors.monthly_budget_rub}>
        {(control) => (
          <input
            {...control}
            className="input num"
            type="text"
            inputMode="decimal"
            placeholder="без ограничения"
            value={form.monthly_budget_rub}
            onChange={(event) => patch({ monthly_budget_rub: event.target.value })}
          />
        )}
      </Field>

      <fieldset className="fieldset">
        <legend className="field__label">Требования и ограничения</legend>
        <div className="checks">
          <Check checked={form.supported_region} onChange={(value) => patch({ supported_region: value })}>
            Предполагается аккаунт и оплата в поддерживаемом регионе API
          </Check>
          <Check checked={form.needs_vision} onChange={(value) => patch({ needs_vision: value })}>
            Работа с изображениями
          </Check>
          <Check checked={form.needs_tool_calling} onChange={(value) => patch({ needs_tool_calling: value })}>
            Вызов функций (tool calling)
          </Check>
          <Check checked={form.allow_foreign_cloud} onChange={(value) => patch({ allow_foreign_cloud: value })}>
            Допускать зарубежное облако
          </Check>
          <Check checked={form.allow_workarounds} onChange={(value) => patch({ allow_workarounds: value })}>
            Допускать обходные пути доступа
          </Check>
        </div>
      </fieldset>

      <Field label="Что важнее">
        {(control) => (
          <select
            {...control}
            className="select"
            value={form.prefer}
            onChange={(event) => patch({ prefer: event.target.value as Preference })}
          >
            {meta.preferences.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Тариф DeepSeek">
        {(control) => <select {...control} className="select" value={form.deepseek_period} onChange={(e) => patch({ deepseek_period: e.target.value as "peak" | "off_peak" })}><option value="peak">Peak — консервативный расчёт</option><option value="off_peak">Off-peak — внепиковая нагрузка</option></select>}
      </Field>
    </form>
  );
}
