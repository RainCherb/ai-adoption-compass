import type { Severity, Tier, RuAccess } from "../api/types";

/** Подписи, которых нет в /api/meta: типы найденных данных, уровни и т. п. */
export const SENSITIVE_KIND_LABELS: Record<string, string> = {
  PRIVATE_KEY: "Закрытый ключ",
  URL_CREDENTIALS: "Ссылка с логином и паролем",
  API_KEY: "Ключ API",
  GITHUB_TOKEN: "Токен GitHub",
  AWS_KEY: "Ключ доступа AWS",
  GOOGLE_KEY: "Ключ Google API",
  SLACK_TOKEN: "Токен Slack",
  JWT: "JWT-токен",
  PASSWORD: "Пароль или секрет",
  BANK_CARD: "Банковская карта",
  SNILS: "СНИЛС",
  INN: "ИНН",
  PASSPORT_RU: "Паспорт РФ",
  EMAIL: "E-mail",
  PHONE_RU: "Телефон",
  BIRTH_DATE: "Дата рождения",
  ADDRESS_RU: "Адрес",
  PERSON_RU: "ФИО",
  IP_ADDRESS: "IP-адрес",
};

export const sensitiveKindLabel = (kind: string): string => SENSITIVE_KIND_LABELS[kind] ?? kind;

export const CONFIDENCE_LABELS: Record<string, string> = {
  high: "высокая",
  medium: "средняя",
  low: "низкая",
};

export const TIER_LABELS: Record<Tier, string> = {
  flagship: "Флагман",
  balanced: "Баланс",
  economy: "Эконом",
};

export const RU_ACCESS_LABELS: Record<RuAccess, string> = {
  direct: "Доступна напрямую",
  workaround: "Через обходные пути",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  info: "Информация",
  warning: "Предупреждение",
  critical: "Критично",
};

export const AUDIT_KIND_LABELS: Record<string, string> = {
  "assessment.created": "Оценка создана",
  "safety.analyze": "Проверка текста",
  "prompt.render": "Промпт собран",
  "prompt.lint": "Проверка промпта",
};

export const AUDIT_KEY_LABELS: Record<string, string> = {
  assessment_id: "id оценки",
  processes: "процессов",
  recommended: "рекомендовано",
  chars: "символов",
  counts: "найдено",
  declared: "заявлено",
  effective: "итог",
  has_secrets: "секреты",
  decisions: "решения",
  template: "шаблон",
  sensitive: "ПДн",
  score: "оценка",
};

export const DATA_STATUS_LABELS: Record<string, string> = {
  illustrative: "демо-данные",
  verified: "проверенные данные",
};
