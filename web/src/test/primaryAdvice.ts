import type { AdviceResult, Recommendation } from "../api/types";
const profiles: NonNullable<Recommendation["profile"]>[] = [
  {
    "id": "claude-sonnet-5-5",
    "name": "Claude Sonnet 5.5",
    "vendor": "Anthropic",
    "api_model": "claude-sonnet-5-5",
    "version_note": "API alias; конкретный snapshot проверяйте при интеграции.",
    "summary": "Документы, разработка и рабочие задачи с чёткими требованиями.",
    "context_label": "1M",
    "context_tokens": 1000000,
    "max_output_tokens": 128000,
    "pricing": {
      "input_per_mtok": 2.0,
      "output_per_mtok": 10.0,
      "cached_input_per_mtok": 0.1,
      "off_peak_input_per_mtok": null,
      "off_peak_output_per_mtok": null,
      "off_peak_cached_input_per_mtok": null,
      "long_context_threshold": null,
      "long_input_multiplier": 1.0,
      "long_output_multiplier": 1.0
    },
    "pricing_source_id": "anthropic-direct-pricing",
    "specs_source_id": "anthropic-models",
    "source_hashes": {
      "anthropic-models": "5f2494e0c8b94c11d9b951c7e46f1947235adc7ad5966466a94b700ee27de133",
      "anthropic-direct-pricing": "b14d213aaa998529a509296a93712897c14d9ccc77bd5d737cba86433a28a8c5"
    },
    "pricing_url": "https://platform.claude.com/docs/en/about-claude/pricing",
    "specs_url": "https://platform.claude.com/docs/en/models/overview",
    "access_url": "https://platform.claude.com/docs/en/api/supported-regions",
    "access_note": "РФ не входит в официальный список регионов API. Доступ требует поддерживаемого региона, аккаунта и оплаты; в демо API не вызывается.",
    "russia_api_status": "unavailable",
    "russia_api_note": "Официальный Claude API недоступен в России: РФ отсутствует в списке поддерживаемых регионов Anthropic.",
    "access_reviewed_at": "2026-10-24",
    "best_for": [
      "Документы и резюмирование",
      "Черновики ответов и редактура",
      "Разработка и разбор кода"
    ],
    "conditions": [
      "Standard, global routing; весь контекст по базовому тарифу.",
      "Cache read $0.10; запись 5 мин $2.50, 1 час $4 за 1 млн токенов. В расчёте кэш не используется.",
      "US-only inference добавляет 10%; Batch даёт скидку 50%. В расчёте не учитываются.",
      "Контекст 1M показан как в документации; для проверки объёма принят консервативный предел 1 000 000 входных и выходных токенов суммарно."
    ],
    "reviewed_at": "2026-10-24",
    "quality_status": "not_measured"
  },
  {
    "id": "gpt-6-1-sol",
    "name": "GPT-6.1 Sol",
    "vendor": "OpenAI",
    "api_model": "gpt-6.1-sol",
    "version_note": "API alias; при работе с инструментами используйте Responses API.",
    "summary": "Разработка, анализ и профессиональные задачи с управляемой глубиной рассуждений.",
    "context_label": "1 050 000",
    "context_tokens": 1050000,
    "max_output_tokens": 128000,
    "pricing": {
      "input_per_mtok": 2.0,
      "output_per_mtok": 10.0,
      "cached_input_per_mtok": 0.1,
      "off_peak_input_per_mtok": null,
      "off_peak_output_per_mtok": null,
      "off_peak_cached_input_per_mtok": null,
      "long_context_threshold": 272000,
      "long_input_multiplier": 2.0,
      "long_output_multiplier": 1.5
    },
    "pricing_source_id": "openai-sol-model",
    "specs_source_id": "openai-sol-model",
    "source_hashes": {
      "openai-sol-model": "6fd7494f924d9d9cb6999c86794d1d09f0f64ec36c4fc8770425919861bceb6d"
    },
    "pricing_url": "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    "specs_url": "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
    "access_url": "https://developers.openai.com/api/docs/supported-countries",
    "access_note": "РФ не входит в официальный список стран API. Подписка ChatGPT/Codex не заменяет оплату API; в демо API не вызывается.",
    "russia_api_status": "unavailable",
    "russia_api_note": "Официальный OpenAI API недоступен в России: РФ отсутствует в списке поддерживаемых стран. Подписка ChatGPT/Codex не оплачивает API.",
    "access_reviewed_at": "2026-10-24",
    "best_for": [
      "Анализ данных и рассуждения",
      "Код, SQL и формулы",
      "Извлечение данных и поддержка решений"
    ],
    "conditions": [
      "Standard; при входе более 272 000 токенов весь запрос тарифицируется по $4 за вход и $15 за выход за 1 млн. Калькулятор учитывает порог.",
      "Cache read $0.10, cache write $2.50 за 1 млн при обычном контексте; кэш в расчёте не используется.",
      "Fast ×2, Ultrafast ×6, Batch/Flex −50%, regional processing +10%. Эти режимы не включены.",
      "Все оплачиваемые output/reasoning токены нужно включить в выход; одинаковое число токенов не означает одинаковое качество."
    ],
    "reviewed_at": "2026-10-24",
    "quality_status": "not_measured"
  },
  {
    "id": "deepseek-v4-1-flash",
    "name": "DeepSeek V4.1 Flash",
    "vendor": "DeepSeek",
    "api_model": "deepseek-flash",
    "version_note": "Документированная версия — DeepSeek-V4.1-Flash-1017; alias может обновляться.",
    "summary": "Текстовые и мультимодальные задачи с отдельными пиковыми и внепиковыми тарифами.",
    "context_label": "1M",
    "context_tokens": 1000000,
    "max_output_tokens": 384000,
    "pricing": {
      "input_per_mtok": 0.3,
      "output_per_mtok": 1.2,
      "cached_input_per_mtok": 0.006,
      "off_peak_input_per_mtok": 0.15,
      "off_peak_output_per_mtok": 0.6,
      "off_peak_cached_input_per_mtok": 0.003,
      "long_context_threshold": null,
      "long_input_multiplier": 1.0,
      "long_output_multiplier": 1.0
    },
    "pricing_source_id": "deepseek-direct-pricing",
    "specs_source_id": "deepseek-direct-pricing",
    "source_hashes": {
      "deepseek-direct-pricing": "b856a6e93fa4793ecc8f3fd03a01bb7d8f7572f78a4739da8ce6dbdb09328d66"
    },
    "pricing_url": "https://api-docs.deepseek.com/quick_start/pricing/",
    "specs_url": "https://api-docs.deepseek.com/quick_start/pricing/",
    "access_url": "https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html",
    "access_note": "Региональный статус API из РФ не подтверждён первоисточником; платёж и доступ с российского IP не проверялись.",
    "russia_api_status": "unverified",
    "russia_api_note": "Доступность прямого API из РФ официально не подтверждена. DeepSeek не публикует список поддерживаемых стран и не гарантирует доступ во всех юрисдикциях (п. 1.5 условий). Успешный вызов из РФ и оплата не проверялись.",
    "access_reviewed_at": "2026-10-24",
    "best_for": [
      "Большой объём типовых обращений",
      "Классификация и извлечение полей",
      "Черновики при ограниченном бюджете"
    ],
    "conditions": [
      "Peak — пн–пт 01:00–04:00 и 06:00–10:00 UTC, кроме официальных праздников Китая. Остальное время — off-peak.",
      "Цена определяется фактическим временем запросов; для смешанной нагрузки рассчитывайте периоды отдельно. По умолчанию выбран более дорогой Peak.",
      "Cache hit за 1 млн — $0.006 Peak или $0.003 Off-peak. Калькулятор использует только cache miss.",
      "Контекст 1M показан как в документации; для проверки объёма принят консервативный предел 1 000 000 входных и выходных токенов суммарно."
    ],
    "reviewed_at": "2026-10-24",
    "quality_status": "not_measured"
  }
];
const data = {
  "workload": {
    "task_type": "classification",
    "data_sensitivity": "public",
    "requests_per_month": 10000,
    "tokens_in": 1000,
    "tokens_out": 300,
    "min_quality": 3,
    "monthly_budget_rub": null,
    "needs_vision": false,
    "needs_tool_calling": false,
    "min_context_tokens": null,
    "must_self_host": false,
    "allow_foreign_cloud": true,
    "allow_workarounds": false,
    "prefer": "quality",
    "supported_region": true,
    "deepseek_period": "peak"
  },
  "model_options": [
    {
      "model_id": "claude-sonnet-5-5",
      "name": "Claude Sonnet 5.5",
      "quality": 5,
      "cost": {
        "variable_rub": 4500.0,
        "fixed_rub": 0.0,
        "total_rub": 4500.0,
        "units": 1,
        "total_usd": 50.0,
        "input_usd": 20.0,
        "output_usd": 30.0,
        "requests_per_month": 10000,
        "input_rate_usd": 2.0,
        "output_rate_usd": 10.0,
        "tariff": "Standard, без кэша"
      },
      "eligible": true,
      "reasons": []
    },
    {
      "model_id": "gpt-6-1-sol",
      "name": "GPT-6.1 Sol",
      "quality": 5,
      "cost": {
        "variable_rub": 4500.0,
        "fixed_rub": 0.0,
        "total_rub": 4500.0,
        "units": 1,
        "total_usd": 50.0,
        "input_usd": 20.0,
        "output_usd": 30.0,
        "requests_per_month": 10000,
        "input_rate_usd": 2.0,
        "output_rate_usd": 10.0,
        "tariff": "Standard, без кэша"
      },
      "eligible": true,
      "reasons": []
    },
    {
      "model_id": "deepseek-v4-1-flash",
      "name": "DeepSeek V4.1 Flash",
      "quality": 4,
      "cost": {
        "variable_rub": 594.0,
        "fixed_rub": 0.0,
        "total_rub": 594.0,
        "units": 1,
        "total_usd": 6.6,
        "input_usd": 3.0,
        "output_usd": 3.6,
        "requests_per_month": 10000,
        "input_rate_usd": 0.3,
        "output_rate_usd": 1.2,
        "tariff": "Peak, без кэша"
      },
      "eligible": true,
      "reasons": []
    }
  ],
  "recommendations": [
    {
      "rank": 1,
      "model_id": "claude-sonnet-5-5",
      "name": "Claude Sonnet 5.5",
      "vendor": "Anthropic",
      "tier": "flagship",
      "deployment": "foreign_cloud",
      "ru_access": "workaround",
      "score": 90.0,
      "quality": 5,
      "cost": {
        "variable_rub": 4500.0,
        "fixed_rub": 0.0,
        "total_rub": 4500.0,
        "units": 1,
        "total_usd": 50.0,
        "input_usd": 20.0,
        "output_usd": 30.0,
        "requests_per_month": 10000,
        "input_rate_usd": 2.0,
        "output_rate_usd": 10.0,
        "tariff": "Standard, без кэша"
      },
      "breakdown": {
        "quality": 1.0,
        "cost": 0.0,
        "safety": 1.0,
        "access": 1.0
      },
      "requires_masking": false,
      "pros": [
        "Оценка качества для задачи «Классификация и маршрутизация»: 5/5",
        "Большое контекстное окно: 1 000 000 токенов",
        "Прямой API: claude-sonnet-5-5; Standard, без кэша"
      ],
      "cons": [
        "Качество 1–5 и итоговая оценка — экспертные допущения, не измеренные метрики",
        "Расчёт предполагает аккаунт и оплату в поддерживаемом регионе; доступ из РФ не подтверждается"
      ]
    },
    {
      "rank": 2,
      "model_id": "gpt-6-1-sol",
      "name": "GPT-6.1 Sol",
      "vendor": "OpenAI",
      "tier": "flagship",
      "deployment": "foreign_cloud",
      "ru_access": "workaround",
      "score": 90.0,
      "quality": 5,
      "cost": {
        "variable_rub": 4500.0,
        "fixed_rub": 0.0,
        "total_rub": 4500.0,
        "units": 1,
        "total_usd": 50.0,
        "input_usd": 20.0,
        "output_usd": 30.0,
        "requests_per_month": 10000,
        "input_rate_usd": 2.0,
        "output_rate_usd": 10.0,
        "tariff": "Standard, без кэша"
      },
      "breakdown": {
        "quality": 1.0,
        "cost": 0.0,
        "safety": 1.0,
        "access": 1.0
      },
      "requires_masking": false,
      "pros": [
        "Оценка качества для задачи «Классификация и маршрутизация»: 5/5",
        "Большое контекстное окно: 1 050 000 токенов",
        "Прямой API: gpt-6.1-sol; Standard, без кэша"
      ],
      "cons": [
        "Качество 1–5 и итоговая оценка — экспертные допущения, не измеренные метрики",
        "Расчёт предполагает аккаунт и оплату в поддерживаемом регионе; доступ из РФ не подтверждается"
      ]
    },
    {
      "rank": 3,
      "model_id": "deepseek-v4-1-flash",
      "name": "DeepSeek V4.1 Flash",
      "vendor": "DeepSeek",
      "tier": "economy",
      "deployment": "foreign_cloud",
      "ru_access": "workaround",
      "score": 85.0,
      "quality": 4,
      "cost": {
        "variable_rub": 594.0,
        "fixed_rub": 0.0,
        "total_rub": 594.0,
        "units": 1,
        "total_usd": 6.6,
        "input_usd": 3.0,
        "output_usd": 3.6,
        "requests_per_month": 10000,
        "input_rate_usd": 0.3,
        "output_rate_usd": 1.2,
        "tariff": "Peak, без кэша"
      },
      "breakdown": {
        "quality": 0.75,
        "cost": 1.0,
        "safety": 1.0,
        "access": 1.0
      },
      "requires_masking": false,
      "pros": [
        "Оценка качества для задачи «Классификация и маршрутизация»: 4/5",
        "Самая низкая стоимость среди подходящих моделей",
        "Большое контекстное окно: 1 000 000 токенов",
        "Прямой API: deepseek-flash; Peak, без кэша"
      ],
      "cons": [
        "Качество 1–5 и итоговая оценка — экспертные допущения, не измеренные метрики",
        "Расчёт предполагает аккаунт и оплату в поддерживаемом регионе; доступ из РФ не подтверждается"
      ]
    }
  ],
  "excluded": [],
  "notes": [
    "Качество — экспертное допущение, не результат замеров. Тарифы основных трёх моделей взяты из официальных источников; перед решением сверьте их и условия с официальными страницами провайдеров.",
    "«DeepSeek V4.1 Flash» дешевле лидера на 87% при оценке качества 4/5 против 5/5 — сравните на своих данных."
  ],
  "catalog_as_of": "2026-10-24",
  "data_status": "illustrative",
  "usd_rub": 90.0
} as const;
export const primaryAdvice: AdviceResult = { ...data, workload: { ...data.workload }, notes: [...data.notes], excluded: [], recommendations: data.recommendations.map((r, i) => ({ ...r, pros: [...r.pros], cons: [...r.cons], profile: profiles[i]! })), model_options: data.model_options.map((o, i) => ({ ...o, reasons: [...o.reasons], profile: profiles[i]! })) };
