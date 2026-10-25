import type { Meta, Preference, Sensitivity, TaskType, Workload } from "../../api/types";
import { formatNumber } from "../../lib/format";

export interface AdvisorFormState {
  task_type: TaskType;
  data_sensitivity: Sensitivity;
  requests_per_month: string;
  tokens_in: string;
  tokens_out: string;
  min_quality: number;
  monthly_budget_rub: string;
  needs_vision: boolean;
  needs_tool_calling: boolean;
  must_self_host: boolean;
  allow_foreign_cloud: boolean;
  allow_workarounds: boolean;
  prefer: Preference;
  supported_region: boolean;
  deepseek_period: "peak" | "off_peak";
}

export type FieldErrors = Partial<Record<"requests_per_month" | "tokens_in" | "tokens_out" | "monthly_budget_rub", string>>;

/** Переключение типа задачи подставляет типичные токены и минимальное качество из /api/meta. */
export function applyTaskType(form: AdvisorFormState, taskType: TaskType, meta: Meta): AdvisorFormState {
  const defaults = meta.task_types.find((item) => item.value === taskType);
  if (!defaults) return { ...form, task_type: taskType };
  return {
    ...form,
    task_type: taskType,
    tokens_in: String(defaults.tokens_in),
    tokens_out: String(defaults.tokens_out),
    min_quality: defaults.min_quality,
  };
}

export function initialForm(meta: Meta): AdvisorFormState {
  const first = (meta.task_types[0]?.value ?? "classification") as TaskType;
  const base: AdvisorFormState = {
    task_type: first,
    data_sensitivity: "internal",
    requests_per_month: "10000",
    tokens_in: "1000",
    tokens_out: "300",
    min_quality: 3,
    monthly_budget_rub: "",
    needs_vision: false,
    needs_tool_calling: false,
    must_self_host: false,
    allow_foreign_cloud: true,
    allow_workarounds: false,
    prefer: "balanced",
    supported_region: false,
    deepseek_period: "peak",
  };
  return applyTaskType(base, first, meta);
}

function parseInteger(text: string, min: number, max: number, label: string): { value: number } | { error: string } {
  const normalized = text.trim().replace(/\s/g, "");
  if (normalized === "") return { error: "Заполните поле" };
  const value = Number(normalized);
  if (!Number.isInteger(value)) return { error: "Нужно целое число" };
  if (value < min) return { error: `${label} не меньше ${formatNumber(min)}` };
  if (value > max) return { error: `${label} не больше ${formatNumber(max)}` };
  return { value };
}

export type ParsedForm = { workload: Workload; errors: null } | { workload: null; errors: FieldErrors };

export function parseForm(form: AdvisorFormState): ParsedForm {
  const errors: FieldErrors = {};
  const requests = parseInteger(form.requests_per_month, 1, 1_000_000_000, "Значение");
  const tokensIn = parseInteger(form.tokens_in, 1, 2_000_000, "Значение");
  const tokensOut = parseInteger(form.tokens_out, 0, 2_000_000, "Значение");
  if ("error" in requests) errors.requests_per_month = requests.error;
  if ("error" in tokensIn) errors.tokens_in = tokensIn.error;
  if ("error" in tokensOut) errors.tokens_out = tokensOut.error;

  let budget: number | null = null;
  const budgetText = form.monthly_budget_rub.trim().replace(/\s/g, "").replace(",", ".");
  if (budgetText !== "") {
    budget = Number(budgetText);
    if (!Number.isFinite(budget) || budget <= 0) errors.monthly_budget_rub = "Бюджет должен быть больше нуля";
  }

  if ("error" in requests || "error" in tokensIn || "error" in tokensOut || errors.monthly_budget_rub) {
    return { workload: null, errors };
  }
  return {
    errors: null,
    workload: {
      task_type: form.task_type,
      data_sensitivity: form.data_sensitivity,
      requests_per_month: requests.value,
      tokens_in: tokensIn.value,
      tokens_out: tokensOut.value,
      min_quality: form.min_quality,
      monthly_budget_rub: budget,
      needs_vision: form.needs_vision,
      needs_tool_calling: form.needs_tool_calling,
      must_self_host: form.must_self_host,
      allow_foreign_cloud: form.allow_foreign_cloud,
      allow_workarounds: form.allow_workarounds,
      prefer: form.prefer,
      supported_region: form.supported_region,
      deepseek_period: form.deepseek_period,
    },
  };
}
