import type {
  AdviceResult,
  AnalyzeResponse,
  AssessmentResult,
  AssessmentSummary,
  Assumptions,
  AuditEvent,
  Catalog,
  EvalDemo,
  Health,
  LintResult,
  Meta,
  Policy,
  Process,
  ProcessResult,
  PromptList,
  Recommendation,
  RenderedPrompt,
  StoredAssessment,
} from "../api/types";

/** Данные собраны по реальным ответам API (сокращены), чтобы формы совпадали с контрактом. */

export const defaultAssumptions: Assumptions = {
  horizon_months: 12,
  implementation_day_rub: 25000,
  support_share_per_month: 0.02,
  llm_overhead: 1.3,
  error_reduction: 0.25,
  usd_rub: 90,
  default_hourly_cost_rub: 800,
  impact_scale_rub: 500000,
  allow_workarounds: false,
  share_infrastructure: true,
  supported_region: false,
  deepseek_period: "peak",
  model_preference: "balanced",
};

export const meta: Meta = {
  demo_mode: false,
  version: "1.0.0",
  task_types: [
    { value: "classification", label: "Классификация и маршрутизация", tokens_in: 700, tokens_out: 60, min_quality: 3, base_automation: 0.7, implementation_days: 6 },
    { value: "drafting", label: "Подготовка текстов и ответов", tokens_in: 800, tokens_out: 500, min_quality: 3, base_automation: 0.5, implementation_days: 4 },
    { value: "analysis", label: "Анализ данных и отчёты", tokens_in: 3000, tokens_out: 800, min_quality: 4, base_automation: 0.4, implementation_days: 10 },
  ],
  sensitivities: [
    { value: "public", label: "Публичные", description: "Уже опубликованная информация.", examples: ["Тексты сайта"] },
    { value: "internal", label: "Внутренние", description: "Рабочие материалы без ПДн.", examples: ["Регламенты"] },
    { value: "confidential", label: "Конфиденциальные", description: "Коммерческая тайна.", examples: ["Договоры"] },
    { value: "personal", label: "Персональные", description: "Данные о физических лицах.", examples: ["Обращения клиентов"] },
  ],
  deployments: [
    { value: "ru_cloud", label: "Российское облако", description: "Обработка в РФ." },
    { value: "foreign_cloud", label: "Зарубежное облако", description: "Обработка за рубежом." },
    { value: "self_hosted", label: "Свой контур (self-hosted)", description: "На ваших серверах." },
  ],
  preferences: [
    { value: "balanced", label: "Баланс" },
    { value: "cost", label: "Минимальная цена" },
    { value: "quality", label: "Максимальное качество" },
    { value: "safety", label: "Максимальная безопасность" },
  ],
  quadrants: [
    { value: "quick_win", label: "Быстрая победа" },
    { value: "strategic", label: "Стратегический проект" },
    { value: "fill_in", label: "Попутная задача" },
    { value: "postpone", label: "Отложить" },
    { value: "blocked", label: "Нет допустимой модели" },
  ],
  actions: [
    { value: "allow", label: "Можно" },
    { value: "mask", label: "После обезличивания" },
    { value: "deny", label: "Нельзя" },
  ],
  default_assumptions: defaultAssumptions,
  thresholds: { impact: 50, ease: 50 },
  limits: { max_text_chars: 200000, max_upload_bytes: 2000000 },
  catalog: {
    as_of: "2026-10-24",
    data_status: "illustrative",
    disclaimer: "Каталог содержит ДЕМОНСТРАЦИОННЫЕ значения: это не прайс-лист.",
  },
};

export const health: Health = {
  demo_mode: false,
  status: "ok",
  version: "1.0.0",
  database: true,
  catalog: { as_of: "2026-10-24", data_status: "illustrative", stale: 0 },
};

// --- оценка процессов ------------------------------------------------------------------------

const scenarios = (net: number): ProcessResult["scenarios"] => [
  { key: "pessimistic", label: "Пессимистичный", net_rub_month: net * 0.4, payback_months: 3.2, net_horizon_rub: net * 4, roi_pct: 82 },
  { key: "base", label: "Базовый", net_rub_month: net, payback_months: 1.1, net_horizon_rub: net * 11, roi_pct: 330 },
  { key: "optimistic", label: "Оптимистичный", net_rub_month: net * 1.3, payback_months: 0.7, net_horizon_rub: net * 14, roi_pct: 540 },
];

export function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
  return {
    rank: 1,
    id: "p1",
    name: "Маршрутизация обращений",
    department: "Поддержка",
    task_type: "classification",
    data_sensitivity: "personal",
    feasible: true,
    hours_per_month: 475,
    manual_cost_month_rub: 332500,
    automation_share: 0.6212,
    net_share: 0.5281,
    hours_saved_month: 250.8,
    savings_month_rub: 175580.78,
    error_savings_month_rub: 28500,
    llm_cost_month_rub: 28046.61,
    support_month_rub: 3750,
    implementation_days: 7.5,
    implementation_rub: 187500,
    net_month_rub: 172284.17,
    payback_months: 1.09,
    net_horizon_rub: 1879910.05,
    roi_pct: 330.4,
    scenarios: scenarios(172284.17),
    fit: 90,
    impact: 97.7,
    ease: 84.4,
    priority: 92.1,
    quadrant: "quick_win",
    wave: 1,
    model: {
      model_id: "qwen-small-selfhost",
      name: "Qwen (компактная открытая модель) — свой контур",
      deployment: "self_hosted",
      requires_masking: false,
      quality: 3,
      score: 80,
      cost: { variable_rub: 0, fixed_rub: 28046.61, total_rub: 28046.61, units: 1 },
    },
    flags: [
      { code: "personal_data", severity: "info", message: "Персональные данные: допустимы модели в РФ или self-hosted." },
      { code: "self_hosted", severity: "warning", message: "Заложены расходы на GPU-инфраструктуру." },
    ],
    ...overrides,
  };
}

export const processResults: ProcessResult[] = [
  processResult(),
  processResult({
    rank: 2,
    id: "p2",
    name: "Разбор входящих счетов",
    department: "Бухгалтерия",
    task_type: "analysis",
    data_sensitivity: "confidential",
    quadrant: "strategic",
    wave: 2,
    hours_saved_month: 75.6,
    implementation_rub: 421875,
    payback_months: 5.22,
    net_horizon_rub: 547998.42,
    net_month_rub: 90000,
    ease: 47.7,
    impact: 66.6,
    scenarios: scenarios(90000),
    model: {
      model_id: "gigachat-lite",
      name: "Сбер GigaChat — лёгкий класс",
      deployment: "ru_cloud",
      requires_masking: true,
      quality: 3,
      score: 74,
      cost: { variable_rub: 4000, fixed_rub: 0, total_rub: 4000, units: 1 },
    },
    flags: [],
  }),
  processResult({
    rank: 3,
    id: "p3",
    name: "Проверка договоров на риски",
    department: "Юристы",
    task_type: "analysis",
    data_sensitivity: "confidential",
    quadrant: "blocked",
    wave: null,
    model: null,
    hours_saved_month: 15.3,
    implementation_rub: 562500,
    payback_months: null,
    net_horizon_rub: 0,
    net_month_rub: 0,
    roi_pct: 0,
    ease: 34.4,
    impact: 0,
    priority: 0,
    scenarios: [],
    flags: [{ code: "no_compliant_model", severity: "critical", message: "Нет модели, проходящей политику данных." }],
  }),
];

export const assessmentResult: AssessmentResult = {
  assumptions: defaultAssumptions,
  catalog_as_of: "2026-10-24",
  data_status: "illustrative",
  processes: processResults,
  roadmap: [
    { wave: 1, title: "Волна 1 — быстрые победы", process_ids: ["p1"], hours_saved_month: 250.8, implementation_rub: 187500, net_horizon_rub: 1879910.05 },
    { wave: 2, title: "Волна 2 — стратегические проекты", process_ids: ["p2"], hours_saved_month: 75.6, implementation_rub: 421875, net_horizon_rub: 547998.42 },
  ],
  summary: {
    processes_total: 3,
    processes_blocked: 1,
    recommended_count: 2,
    total_hours_month: 1000,
    manual_cost_month_rub: 800000,
    hours_saved_month: 326.4,
    fte_equivalent: 2.04,
    benefit_month_rub: 300000,
    cost_month_rub: 40000,
    net_month_rub: 260000,
    implementation_rub: 609375,
    payback_months: 2.34,
    net_horizon_rub: 2427908.47,
    roi_pct: 155.4,
    quadrant_counts: { quick_win: 1, strategic: 1, fill_in: 0, postpone: 0, blocked: 1 },
    infrastructure: [
      { model_id: "qwen-small-selfhost", name: "Qwen (компактная открытая модель) — свой контур", process_ids: ["p1"], units: 1, fixed_rub_month: 70000 },
    ],
  },
  warnings: ["Каталог моделей содержит демонстрационные цены."],
};

export const processes: Process[] = processResults.map((p) => ({
  id: p.id,
  name: p.name,
  department: p.department,
  task_type: p.task_type,
  runs_per_month: 1000,
  minutes_per_run: 5,
  data_sensitivity: p.data_sensitivity,
  digital_readiness: 3,
  error_cost_rub: 0,
  error_rate: 0.05,
  risk_level: 2,
  standardization: 3,
  must_self_host: false,
}));

export const stored: StoredAssessment = {
  id: "a1",
  name: "Демо: ООО «Ромашка»",
  created_at: "2026-10-24T03:11:06+00:00",
  processes,
  assumptions: null,
  result: assessmentResult,
};

export const savedSummary: AssessmentSummary = {
  id: "a1",
  name: "Демо: ООО «Ромашка»",
  created_at: "2026-10-24T03:11:06+00:00",
  processes_count: 3,
  recommended_count: 2,
  hours_saved_month: 326.4,
  net_horizon_rub: 2427908.47,
};

// --- подбор моделей --------------------------------------------------------------------------

function recommendation(overrides: Partial<Recommendation>): Recommendation {
  return {
    rank: 1,
    model_id: "gigachat-lite",
    name: "Сбер GigaChat — лёгкий класс",
    vendor: "Сбер",
    tier: "economy",
    deployment: "ru_cloud",
    ru_access: "direct",
    score: 74,
    quality: 3,
    cost: { variable_rub: 469.3, fixed_rub: 0, total_rub: 469.3, units: 1 },
    breakdown: { quality: 0.5, cost: 1, safety: 0.7, access: 1 },
    requires_masking: true,
    pros: ["Обработка в РФ", "Самая низкая стоимость среди подходящих моделей"],
    cons: ["Перед отправкой данные нужно обезличивать"],
    ...overrides,
  };
}

export const advice: AdviceResult = {
  catalog_as_of: "2026-10-24",
  data_status: "illustrative",
  usd_rub: 90,
  notes: ["Данные каталога демонстрационные: сверьте тарифы с официальными страницами."],
  workload: {
    task_type: "classification",
    data_sensitivity: "personal",
    requests_per_month: 10000,
    tokens_in: 700,
    tokens_out: 60,
    min_quality: 3,
    monthly_budget_rub: null,
    needs_vision: false,
    needs_tool_calling: false,
    min_context_tokens: null,
    must_self_host: false,
    allow_foreign_cloud: true,
    allow_workarounds: false,
    prefer: "balanced",
    supported_region: false,
    deepseek_period: "peak",
  },
  recommendations: [
    recommendation({}),
    recommendation({
      rank: 2,
      model_id: "yandexgpt-pro",
      name: "Yandex Cloud YandexGPT — Pro-класс",
      vendor: "Яндекс",
      tier: "balanced",
      score: 71,
      cost: { variable_rub: 3040, fixed_rub: 0, total_rub: 3040, units: 1 },
      breakdown: { quality: 0.75, cost: 0.78, safety: 0.9, access: 1 },
    }),
  ],
  excluded: [
    {
      model_id: "openai-flagship",
      name: "OpenAI GPT — флагманский класс",
      deployment: "foreign_cloud",
      kinds: ["policy", "access"],
      reasons: [
        "Политика данных: для категории «персональные» размещение «Зарубежное облако» запрещено",
        "Доступ из РФ только через обходные пути",
      ],
    },
    {
      model_id: "qwen-large-selfhost",
      name: "Qwen — свой контур",
      deployment: "self_hosted",
      kinds: ["budget"],
      reasons: ["Стоимость выше бюджета"],
    },
  ],
};

export const catalog: Catalog = {
  as_of: "2026-10-24",
  data_status: "illustrative",
  disclaimer: "Каталог содержит ДЕМОНСТРАЦИОННЫЕ значения: это не прайс-лист.",
  usd_rub: 90,
  stale: [],
  models: [
    {
      id: "openai-flagship",
      name: "OpenAI GPT — флагманский класс",
      vendor: "OpenAI",
      family: "GPT",
      tier: "flagship",
      deployment: "foreign_cloud",
      origin: "США",
      ru_access: "workaround",
      pricing: { currency: "USD", input_per_mtok: 2.5, output_per_mtok: 10, fixed_monthly: 0, capacity_mtok_month: null },
      context_window: 128000,
      vision: true,
      tool_calling: true,
      quality: { classification: 5, extraction: 5, summarization: 5, drafting: 5, qa_search: 5, translation: 5, analysis: 5, code: 5, decision_support: 5 },
      strengths: [],
      limitations: [],
      pricing_url: null,
      reviewed_at: "2026-10-24",
      notes: null,
    },
  ],
};

// --- безопасность данных ---------------------------------------------------------------------

const PHONE = "+7 (999) 123-45-67";
const EMAIL = "ivan@example.com";
export const analysisText = `Привет 😀! Звоните ${PHONE}, почта ${EMAIL}`;

/** Смещения в кодовых точках Unicode — как у бэкенда (индексы строки Python). */
function span(part: string): { start: number; end: number } {
  const start = Array.from(analysisText.slice(0, analysisText.indexOf(part))).length;
  return { start, end: start + Array.from(part).length };
}

export const analysis: AnalyzeResponse = {
  chars: Array.from(analysisText).length,
  counts: { PHONE_RU: 1, EMAIL: 1 },
  declared_sensitivity: "internal",
  detected_sensitivity: "personal",
  effective_sensitivity: "personal",
  has_secrets: false,
  findings: [
    { kind: "PHONE_RU", label: "Телефон", tag: "PHONE", ...span(PHONE), preview: "+7••••••••67", implied_sensitivity: "personal", is_secret: false, confidence: "high" },
    { kind: "EMAIL", label: "E-mail", tag: "EMAIL", ...span(EMAIL), preview: "i•••@e•••", implied_sensitivity: "personal", is_secret: false, confidence: "high" },
  ],
  decisions: [
    { target: "ru_cloud", action: "mask", reasons: ["Категория «персональные»: только после обезличивания."] },
    { target: "foreign_cloud", action: "deny", reasons: ["Отправка за рубеж запрещена политикой."] },
    { target: "self_hosted", action: "allow", reasons: [] },
  ],
  masked_text: "Привет 😀! Звоните [PHONE_1], почта [EMAIL_1]",
  mapping: { "[PHONE_1]": PHONE, "[EMAIL_1]": EMAIL },
};

export const policy: Policy = {
  updated: "2026-10-24",
  disclaimer: "Политика — шаблон, не юридическая консультация.",
  classes: meta.sensitivities,
  deployments: meta.deployments,
  actions: [
    { value: "allow", label: "Можно", description: "Можно отправлять как есть." },
    { value: "mask", label: "После обезличивания", description: "Только после замены идентификаторов." },
    { value: "deny", label: "Нельзя", description: "Отправлять нельзя." },
  ],
  matrix: {
    public: { ru_cloud: "allow", foreign_cloud: "allow", self_hosted: "allow" },
    internal: { ru_cloud: "allow", foreign_cloud: "mask", self_hosted: "allow" },
    confidential: { ru_cloud: "mask", foreign_cloud: "deny", self_hosted: "allow" },
    personal: { ru_cloud: "mask", foreign_cloud: "deny", self_hosted: "allow" },
  },
  do: ["Определяйте категорию данных перед отправкой."],
  dont: ["Не вставляйте пароли и ключи API."],
  secrets_message: "Найдены секреты: их нельзя передавать ни в одну модель.",
  handout_markdown: "# Памятка: безопасная работа с нейросетями\n",
};

// --- промпты ---------------------------------------------------------------------------------

export const promptList: PromptList = {
  departments: ["Поддержка", "Юристы"],
  templates: [
    {
      id: "customer-reply",
      title: "Ответ клиенту на обращение",
      department: "Поддержка",
      task_type: "drafting",
      sensitivity: "internal",
      description: "Вежливый ответ на жалобу или вопрос клиента.",
      variables: [
        { name: "message", label: "Сообщение клиента", type: "text", required: true, default: null, choices: null, example: "Заказ не пришёл вовремя" },
        { name: "tone", label: "Тон ответа", type: "choice", required: true, default: "вежливый", choices: ["вежливый", "деловой"], example: null },
        { name: "signature", label: "Подпись", type: "string", required: false, default: null, choices: null, example: "Команда поддержки" },
      ],
      body: "{{ message }}",
      checklist: ["Тон соответствует бренду."],
      safety_notes: ["Уберите персональные данные клиента."],
    },
    {
      id: "contract-risk",
      title: "Разбор договора на риски",
      department: "Юристы",
      task_type: "analysis",
      sensitivity: "confidential",
      description: "Предварительная проверка договора.",
      variables: [{ name: "contract", label: "Текст договора", type: "text", required: true, default: null, choices: null, example: "Пункт 1…" }],
      body: "{{ contract }}",
      checklist: [],
      safety_notes: [],
    },
  ],
};

export const rendered: RenderedPrompt = {
  template_id: "customer-reply",
  title: "Ответ клиенту на обращение",
  text: "Ты — менеджер поддержки. Ответь клиенту вежливо: Заказ не пришёл вовремя",
  warnings: [],
  sensitive: {},
  lint_score: 78,
  recommended_sensitivity: "internal",
  checklist: ["Тон соответствует бренду."],
  safety_notes: ["Уберите персональные данные клиента."],
};

export const lint: LintResult = {
  score: 42,
  grade: "D",
  words: 8,
  capped: true,
  sensitive: { PHONE_RU: 1 },
  checks: [
    { id: "role", label: "Задана роль", passed: false, weight: 10, hint: "Начните с роли: «Ты — опытный …»." },
    { id: "task", label: "Чётко поставлена задача", passed: true, weight: 20, hint: null },
  ],
  suggestions: ["В запросе есть персональные данные: обезличьте их.", "Начните с роли."],
};

// --- качество моделей и журнал ---------------------------------------------------------------

function evalReport(provider: string, accuracy: number, cost: number | null, baseline = false): EvalDemo["reports"][number] {
  return {
    provider,
    task_id: "ticket-routing",
    n: 8,
    errors: 0,
    is_baseline: baseline,
    cost_rub: cost,
    cost_per_1k_rub: cost === null ? null : cost * 10,
    cost_per_correct_rub: cost === null ? null : cost / 8,
    accuracy_lift: baseline ? 0 : accuracy - 0.75,
    latency: { mean_ms: 440, p50_ms: 442.6, p95_ms: 503.6 },
    tokens_in: 1000,
    tokens_out: 50,
    metrics: {
      accuracy,
      macro_f1: accuracy - 0.01,
      invalid: baseline ? 0 : 1,
      n: 8,
      labels: ["billing", "delivery"],
      confusion: provider === "sim:flagship" ? [[4, 0], [0, 4]] : [[3, 1], [2, 2]],
      per_class: [
        { label: "billing", precision: 0.75, recall: 0.8, f1: 0.77, support: 4 },
        { label: "delivery", precision: 1, recall: 0.5, f1: 0.67, support: 4 },
      ],
    },
    failures: [{ id: "f1", expected: "billing", got: null, text: "Оплатил картой, но заказ не оплачен" }],
  };
}

export const evalDemo: EvalDemo = {
  kind: "simulated",
  task: {
    id: "ticket-routing",
    title: "Маршрутизация обращений клиентов",
    description: "Отнесите обращение клиента к одной из категорий.",
    items: 8,
    labels: [
      { name: "billing", title: "Оплата и счета" },
      { name: "delivery", title: "Доставка" },
    ],
  },
  markdown: "# Оценка качества\n",
  reports: [
    evalReport("baseline:keywords", 0.75, 0, true),
    evalReport("sim:economy", 0.8, 0.79),
    evalReport("sim:flagship", 0.97, 28.4),
  ],
};

export const auditEvents: AuditEvent[] = [
  { id: 3, ts: "2026-10-24T03:14:12+00:00", kind: "prompt.lint", payload: { chars: 58, score: 20, sensitive: { PHONE_RU: 1 } } },
  { id: 2, ts: "2026-10-24T03:13:47+00:00", kind: "safety.analyze", payload: { chars: 142, has_secrets: true, decisions: { ru_cloud: "deny" } } },
  { id: 1, ts: "2026-10-24T03:11:06+00:00", kind: "assessment.created", payload: { assessment_id: "a1", processes: 18, recommended: 11 } },
];
