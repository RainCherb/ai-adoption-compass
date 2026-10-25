export const NBSP = "\u00A0";
const MINUS = "\u2212";
export const DASH = "—";

type Nullish = null | undefined;

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(minFraction: number, maxFraction: number): Intl.NumberFormat {
  const key = `${minFraction}:${maxFraction}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat("ru-RU", {
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    });
    numberFormats.set(key, format);
  }
  return format;
}

function isMissing(value: number | Nullish): value is Nullish {
  return value === null || value === undefined || !Number.isFinite(value);
}

/** Число в ru-RU: неразрывные пробелы между разрядами, запятая, настоящий минус. */
export function formatNumber(value: number | Nullish, maxFraction = 0, minFraction = 0): string {
  if (isMissing(value)) return DASH;
  const rounded = Number(Math.abs(value).toFixed(maxFraction));
  const text = numberFormat(Math.min(minFraction, maxFraction), maxFraction).format(rounded).replace(/\s/g, NBSP);
  return value < 0 && rounded !== 0 ? `${MINUS}${text}` : text;
}

export function formatRub(value: number | Nullish): string {
  return isMissing(value) ? DASH : `${formatNumber(value)}${NBSP}₽`;
}

/** Для малых сумм (цена одного запроса): больше знаков после запятой, ненулевая сумма не округляется до нуля. */
export function formatRubPrecise(value: number | Nullish): string {
  if (isMissing(value)) return DASH;
  const abs = Math.abs(value);
  const digits = abs === 0 ? 0 : abs < 0.001 ? 8 : abs < 1 ? 3 : abs < 100 ? 2 : 0;
  return `${formatNumber(value, digits)}${NBSP}₽`;
}

/** «5,8 млн ₽» — для карточек, где важен порядок величины. */
export function formatRubCompact(value: number | Nullish): string {
  if (isMissing(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${formatNumber(value / 1e9, 1)}${NBSP}млрд${NBSP}₽`;
  if (abs >= 1e6) return `${formatNumber(value / 1e6, 1)}${NBSP}млн${NBSP}₽`;
  if (abs >= 1e5) return `${formatNumber(value / 1e3, 0)}${NBSP}тыс.${NBSP}₽`;
  return formatRub(value);
}

export function formatUsd(value: number | Nullish): string {
  return isMissing(value) ? DASH : `${formatNumber(value, 2, 2)}${NBSP}$`;
}

/** «$6,6»: два знака для сумм от доллара, больше — для малых, чтобы они не превращались в ноль. */
export function formatDollars(value: number | Nullish): string {
  if (isMissing(value)) return DASH;
  const abs = Math.abs(value);
  const digits = abs >= 1 || abs === 0 ? 2 : abs >= 0.01 ? 4 : 8;
  return `$${formatNumber(value, digits)}`;
}

export function formatMonths(value: number | Nullish): string {
  return isMissing(value) ? DASH : `${formatNumber(value, 1)}${NBSP}мес.`;
}

export function formatHours(value: number | Nullish, digits = 1): string {
  return isMissing(value) ? DASH : `${formatNumber(value, digits)}${NBSP}ч`;
}

export function formatDays(value: number | Nullish): string {
  return isMissing(value) ? DASH : `${formatNumber(value, 1)}${NBSP}дн.`;
}

export function formatFte(value: number | Nullish): string {
  return isMissing(value) ? DASH : `${formatNumber(value, 1)}${NBSP}FTE`;
}

/** Доля 0…1 → «25 %». */
export function formatPercent(fraction: number | Nullish, digits = 0): string {
  return isMissing(fraction) ? DASH : `${formatNumber(fraction * 100, digits, digits)}${NBSP}%`;
}

/** Уже проценты (например, ROI = 155,4) → «155 %». */
export function formatPercentValue(percent: number | Nullish, digits = 0): string {
  return isMissing(percent) ? DASH : `${formatNumber(percent, digits)}${NBSP}%`;
}

export function formatBytes(bytes: number | Nullish): string {
  if (isMissing(bytes)) return DASH;
  if (bytes >= 1_000_000) return `${formatNumber(bytes / 1_000_000, 1)}${NBSP}МБ`;
  if (bytes >= 1_000) return `${formatNumber(bytes / 1_000, 0)}${NBSP}КБ`;
  return `${formatNumber(bytes)}${NBSP}Б`;
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(count));
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatCount(count: number, one: string, few: string, many: string): string {
  return `${formatNumber(count)}${NBSP}${pluralRu(count, one, few, many)}`;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const dateFormat = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateUtcFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** «24.10.2026». Даты без времени (YYYY-MM-DD) не сдвигаются часовым поясом. */
export function formatDate(iso: string | Nullish): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return (DATE_ONLY.test(iso) ? dateUtcFormat : dateFormat).format(date);
}

/** «24.10.2026, 03:11» в часовом поясе пользователя. */
export function formatDateTime(iso: string | Nullish): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}
