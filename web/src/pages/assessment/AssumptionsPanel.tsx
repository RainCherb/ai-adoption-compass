import { useState } from "react";
import type { ApiError } from "../../api/errors";
import type { Assumptions } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Disclosure } from "../../components/ui/Disclosure";
import { ErrorBanner } from "../../components/ui/Banner";
import { Field } from "../../components/ui/Field";
import { formatNumber } from "../../lib/format";

type NumericKey =
  | "horizon_months"
  | "implementation_day_rub"
  | "default_hourly_cost_rub"
  | "usd_rub"
  | "llm_overhead"
  | "error_reduction";

interface NumericField {
  key: NumericKey;
  label: string;
  hint: string;
  min: number;
  max?: number;
  integer?: boolean;
  /** Строго больше min (стоимость часа и курс не могут быть нулевыми). */
  exclusiveMin?: boolean;
}

const NUMERIC_FIELDS: readonly NumericField[] = [
  { key: "horizon_months", label: "Горизонт, мес.", hint: "от 1 до 60", min: 1, max: 60, integer: true },
  { key: "implementation_day_rub", label: "Стоимость дня внедрения, ₽", hint: "от 0", min: 0 },
  { key: "default_hourly_cost_rub", label: "Стоимость часа по умолчанию, ₽", hint: "больше 0", min: 0, exclusiveMin: true },
  { key: "usd_rub", label: "Курс USD/RUB", hint: "больше 0", min: 0, exclusiveMin: true },
  { key: "llm_overhead", label: "Накладные расходы LLM, ×", hint: "множитель токенов: 1–5", min: 1, max: 5 },
  { key: "error_reduction", label: "Снижение ошибок, %", hint: "от 0 до 100", min: 0, max: 100 },
];

interface FormState {
  numbers: Record<NumericKey, string>;
  supported_region: boolean;
  deepseek_period: "peak" | "off_peak";
  model_preference: "balanced" | "cost" | "quality" | "safety";
  allow_workarounds: boolean;
  share_infrastructure: boolean;
}

/** Снижение ошибок хранится долей (0,25), а редактируется в процентах. */
const toDisplay = (key: NumericKey, assumptions: Assumptions): number =>
  key === "error_reduction" ? Math.round(assumptions.error_reduction * 1000) / 10 : assumptions[key];

function toForm(assumptions: Assumptions): FormState {
  const numbers = Object.fromEntries(
    NUMERIC_FIELDS.map((field) => [field.key, String(toDisplay(field.key, assumptions))]),
  ) as Record<NumericKey, string>;
  return {
    numbers,
    supported_region: assumptions.supported_region ?? false,
    deepseek_period: assumptions.deepseek_period ?? "peak",
    model_preference: assumptions.model_preference ?? "balanced",
    allow_workarounds: assumptions.allow_workarounds,
    share_infrastructure: assumptions.share_infrastructure,
  };
}

function parseNumber(text: string): number {
  const normalized = text.trim().replace(",", ".");
  return normalized === "" ? Number.NaN : Number(normalized);
}

function fieldError(field: NumericField, text: string): string | undefined {
  const value = parseNumber(text);
  if (!Number.isFinite(value)) return "Введите число";
  if (field.integer && !Number.isInteger(value)) return "Нужно целое число";
  if (field.exclusiveMin ? value <= field.min : value < field.min) {
    return field.exclusiveMin ? `Должно быть больше ${field.min}` : `Не меньше ${field.min}`;
  }
  if (field.max !== undefined && value > field.max) return `Не больше ${field.max}`;
  return undefined;
}

function fromForm(form: FormState, base: Assumptions): Assumptions {
  const get = (key: NumericKey) => parseNumber(form.numbers[key]);
  return {
    ...base,
    supported_region: form.supported_region,
    deepseek_period: form.deepseek_period,
    model_preference: form.model_preference,
    horizon_months: get("horizon_months"),
    implementation_day_rub: get("implementation_day_rub"),
    default_hourly_cost_rub: get("default_hourly_cost_rub"),
    usd_rub: get("usd_rub"),
    llm_overhead: get("llm_overhead"),
    error_reduction: get("error_reduction") / 100,
    allow_workarounds: form.allow_workarounds,
    share_infrastructure: form.share_infrastructure,
  };
}

interface AssumptionsPanelProps {
  /** Допущения, с которыми посчитан сохранённый результат. */
  baseline: Assumptions;
  /** Значения по умолчанию из /api/meta. */
  defaults: Assumptions;
  whatIfActive: boolean;
  busy: boolean;
  error: ApiError | undefined;
  onRecalculate: (assumptions: Assumptions) => void;
  onReset: () => void;
}

export function AssumptionsPanel({ baseline, defaults, whatIfActive, busy, error, onRecalculate, onReset }: AssumptionsPanelProps) {
  const [form, setForm] = useState<FormState>(() => toForm(baseline));
  const errors = Object.fromEntries(
    NUMERIC_FIELDS.map((field) => [field.key, fieldError(field, form.numbers[field.key])]),
  ) as Record<NumericKey, string | undefined>;
  const valid = NUMERIC_FIELDS.every((field) => !errors[field.key]);
  const baseForm = toForm(baseline);

  const setNumber = (key: NumericKey, value: string) =>
    setForm((previous) => ({ ...previous, numbers: { ...previous.numbers, [key]: value } }));

  return (
    <Disclosure
      title="Допущения"
      className="assumptions"
      meta={whatIfActive ? <Badge tone="warning">изменены</Badge> : <span className="muted small">значения расчёта</span>}
    >
      <form
        className="assumptions__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onRecalculate(fromForm(form, baseline));
        }}
        noValidate
      >
        <div className="assumptions__grid">
          {NUMERIC_FIELDS.map((field) => {
            const changed = form.numbers[field.key].trim() !== baseForm.numbers[field.key];
            return (
              <Field
                key={field.key}
                label={
                  <>
                    {field.label}
                    {changed ? <Badge tone="warning" className="field__badge">изменено</Badge> : null}
                  </>
                }
                hint={`${field.hint} · по умолчанию ${formatNumber(toDisplay(field.key, defaults), 2)}`}
                error={errors[field.key]}
              >
                {(control) => (
                  <input
                    {...control}
                    className="input num"
                    type="text"
                    inputMode="decimal"
                    value={form.numbers[field.key]}
                    onChange={(event) => setNumber(field.key, event.target.value)}
                  />
                )}
              </Field>
            );
          })}
        </div>

        <div className="assumptions__checks">
          <Field label="Приоритет подбора">
            {(control) => <select {...control} className="input" value={form.model_preference} onChange={(event) => setForm((previous) => ({ ...previous, model_preference: event.target.value as FormState["model_preference"] }))}>
              <option value="quality">Качество</option><option value="cost">Стоимость</option><option value="balanced">Баланс</option><option value="safety">Безопасность</option>
            </select>}
          </Field>
          <Field label="Тариф DeepSeek" hint="Период задаётся вручную. По умолчанию — более дорогой Peak.">
            {(control) => <select {...control} className="input" value={form.deepseek_period} onChange={(event) => setForm((previous) => ({ ...previous, deepseek_period: event.target.value as FormState["deepseek_period"] }))}>
              <option value="peak">Peak</option><option value="off_peak">Off-peak</option>
            </select>}
          </Field>
          <label className="check">
            <input type="checkbox" checked={form.supported_region} onChange={(event) => setForm((previous) => ({ ...previous, supported_region: event.target.checked }))} />
            <span>Предположить доступный аккаунт и оплату в поддерживаемом регионе API. Это допущение демо, доступ из РФ не гарантируется.</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.allow_workarounds}
              onChange={(event) => setForm((previous) => ({ ...previous, allow_workarounds: event.target.checked }))}
            />
            <span>Допускать обходные пути доступа к зарубежным моделям</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.share_infrastructure}
              onChange={(event) => setForm((previous) => ({ ...previous, share_infrastructure: event.target.checked }))}
            />
            <span>Делить self-hosted инфраструктуру между процессами</span>
          </label>
        </div>

        {error ? <ErrorBanner error={error} title="Не удалось пересчитать" /> : null}

        <div className="assumptions__actions">
          <Button type="submit" variant="primary" icon="refresh" loading={busy} disabled={!valid}>
            Пересчитать
          </Button>
          <Button onClick={() => setForm(toForm(defaults))} disabled={busy}>
            Значения по умолчанию
          </Button>
          {whatIfActive ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setForm(toForm(baseline));
                onReset();
              }}
            >
              Вернуть сохранённый расчёт
            </Button>
          ) : null}
        </div>
      </form>
    </Disclosure>
  );
}
