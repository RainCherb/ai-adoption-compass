/** Единая ошибка API: `message` — читаемая строка, `details` — отдельные пункты (если есть). */
export class ApiError extends Error {
  readonly status: number;
  readonly summary: string;
  readonly details: string[];

  constructor(summary: string, status: number, details: string[] = []) {
    super(details.length > 0 ? `${summary}: ${details.join("; ")}` : summary);
    this.name = "ApiError";
    this.status = status;
    this.summary = summary;
    this.details = details;
  }
}

export const NETWORK_MESSAGE =
  "Не удалось связаться с сервером. Проверьте, что API запущен, и повторите попытку.";

const FIELD_LABELS: Record<string, string> = {
  name: "Название",
  processes: "Процессы",
  assumptions: "Допущения",
  task_type: "Тип задачи",
  data_sensitivity: "Категория данных",
  requests_per_month: "Запросов в месяц",
  runs_per_month: "Запусков в месяц",
  minutes_per_run: "Минут на запуск",
  tokens_in: "Токенов на входе",
  tokens_out: "Токенов на выходе",
  min_quality: "Минимальное качество",
  monthly_budget_rub: "Бюджет в месяц",
  min_context_tokens: "Минимальный контекст",
  prefer: "Приоритет",
  horizon_months: "Горизонт, мес.",
  implementation_day_rub: "Стоимость дня внедрения",
  default_hourly_cost_rub: "Стоимость часа",
  usd_rub: "Курс USD/RUB",
  llm_overhead: "Накладные расходы LLM",
  error_reduction: "Снижение ошибок",
  text: "Текст",
  task: "Задача",
  role: "Роль",
  values: "Значения",
  mapping: "Соответствия",
  limit: "Лимит",
  top: "Сколько показать",
  file: "Файл",
};

interface ValidationItem {
  loc?: unknown;
  msg?: unknown;
  type?: unknown;
  ctx?: unknown;
}

const TYPE_MESSAGES: Record<string, (ctx: Record<string, unknown>) => string> = {
  missing: () => "обязательное поле",
  greater_than: (c) => `должно быть больше ${String(c["gt"])}`,
  greater_than_equal: (c) => `не меньше ${String(c["ge"])}`,
  less_than: (c) => `должно быть меньше ${String(c["lt"])}`,
  less_than_equal: (c) => `не больше ${String(c["le"])}`,
  string_too_short: (c) => `слишком короткое значение (минимум ${String(c["min_length"])} симв.)`,
  string_too_long: (c) => `слишком длинное значение (максимум ${String(c["max_length"])} симв.)`,
  too_short: (c) => `нужно минимум элементов: ${String(c["min_length"])}`,
  too_long: (c) => `допустимо не более элементов: ${String(c["max_length"])}`,
  enum: () => "недопустимое значение",
  literal_error: () => "недопустимое значение",
  int_parsing: () => "нужно целое число",
  int_from_float: () => "нужно целое число",
  int_type: () => "нужно целое число",
  float_parsing: () => "нужно число",
  float_type: () => "нужно число",
  bool_parsing: () => "нужно значение «да» или «нет»",
  bool_type: () => "нужно значение «да» или «нет»",
  string_type: () => "нужна строка",
  json_invalid: () => "некорректный JSON",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Некорректный запрос",
  404: "Не найдено",
  405: "Метод не поддерживается",
  413: "Слишком большой запрос",
  415: "Неподдерживаемый формат данных",
  429: "Слишком много запросов, подождите немного",
};

const KNOWN_ENGLISH: Record<string, string> = {
  "Not Found": "Не найдено",
  "Method Not Allowed": "Метод не поддерживается",
  "Internal Server Error": "Внутренняя ошибка сервера",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeLocation(loc: unknown): string {
  if (!Array.isArray(loc)) return "";
  const parts = loc
    .filter((part, index) => !(index === 0 && (part === "body" || part === "query" || part === "path")))
    .map((part) => (typeof part === "number" ? `№${part + 1}` : (FIELD_LABELS[String(part)] ?? String(part))));
  return parts.join(" → ");
}

function formatValidationItem(item: unknown): string {
  if (typeof item === "string") return item;
  if (!isRecord(item)) return "Некорректные данные";
  const { loc, msg, type, ctx } = item as ValidationItem;
  const where = describeLocation(loc);
  const translate = typeof type === "string" ? TYPE_MESSAGES[type] : undefined;
  const reason = translate ? translate(isRecord(ctx) ? ctx : {}) : typeof msg === "string" ? msg : "некорректное значение";
  return where ? `${where}: ${reason}` : reason;
}

function formatRowError(item: unknown): string {
  if (typeof item === "string") return item;
  if (isRecord(item) && typeof item["message"] === "string") {
    return typeof item["line"] === "number" ? `строка ${item["line"]}: ${item["message"]}` : item["message"];
  }
  return formatValidationItem(item);
}

/** Приводит три формата ошибок бэкенда (строка, {message, errors}, список валидации FastAPI) к одному. */
export function normalizeErrorBody(body: unknown, status: number): ApiError {
  const fallback = STATUS_MESSAGES[status] ?? (status >= 500 ? `Ошибка сервера (HTTP ${status}). Повторите попытку позже.` : `Ошибка запроса (HTTP ${status})`);
  const detail = isRecord(body) ? body["detail"] : undefined;

  if (typeof detail === "string") {
    return new ApiError(KNOWN_ENGLISH[detail] ?? (detail.trim() || fallback), status);
  }
  if (Array.isArray(detail)) {
    const items = detail.map(formatValidationItem);
    return new ApiError(items.length > 0 ? "Проверьте введённые данные" : fallback, status, items);
  }
  if (isRecord(detail)) {
    const message = typeof detail["message"] === "string" && detail["message"] ? detail["message"] : fallback;
    const errors = Array.isArray(detail["errors"]) ? detail["errors"].map(formatRowError) : [];
    return new ApiError(message, status, errors);
  }
  return new ApiError(fallback, status);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(error instanceof Error && error.message ? error.message : "Неизвестная ошибка", 0);
}
