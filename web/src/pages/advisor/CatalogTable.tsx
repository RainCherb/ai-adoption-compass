import { getCatalog } from "../../api/client";
import type { CatalogModel, TaskType } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Icon } from "../../components/ui/Icon";
import { LoadingRegion, SkeletonLines } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { labelOf, useMeta } from "../../hooks/useMeta";
import { formatDate, formatNumber, formatRub, formatUsd } from "../../lib/format";
import { TIER_LABELS } from "../../lib/labels";
import { formatRatePair, taxNote } from "../../lib/pricing";
import { CatalogSources } from "./CatalogSources";
import { RussiaAccess } from "./RussiaAccess";
import { Disclosure } from "../../components/ui/Disclosure";

function price(model: CatalogModel): string {
  const { currency, input_per_mtok: input, output_per_mtok: output } = model.pricing;
  return formatRatePair(input, output, currency);
}

function taxLabel(model: CatalogModel): string {
  return taxNote({ currency: model.pricing.currency, vatIncluded: model.profile?.vat_included ?? false });
}

function contextWindow(tokens: number): string {
  return tokens >= 1000 ? `${formatNumber(tokens / 1000)} тыс.` : formatNumber(tokens);
}

export function CatalogTable({ taskType }: { taskType: TaskType }) {
  const meta = useMeta();
  const catalog = useAsync((signal) => getCatalog(signal), "catalog");
  const taskLabel = labelOf(meta.task_types, taskType);

  if (catalog.error) return <ErrorBanner error={catalog.error} onRetry={catalog.reload} title="Не удалось загрузить каталог" />;
  if (!catalog.data) {
    return (
      <LoadingRegion label="Загружаем каталог моделей…">
        <SkeletonLines lines={8} />
      </LoadingRegion>
    );
  }

  const { models, stale } = catalog.data;
  const staleIds = new Set(stale.map((entry) => entry.id));
  // Колонка нужна только каталогам с арендой инфраструктуры; у API-моделей она пустая.
  const showFixed = models.some((model) => model.pricing.fixed_monthly > 0);

  return (
    <div className="stack">
      {catalog.data.data_status === "illustrative" && !meta.demo_mode ? (
        <Banner tone="warning" title="Каталог справочный: оценки качества — экспертные допущения">
          {catalog.data.disclaimer}
        </Banner>
      ) : null}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Каталог моделей">
        <table className="table catalog-table" data-testid="catalog-table">
          <caption className="visually-hidden">
            Каталог моделей: размещение, цены за 1 млн токенов, возможности и оценка качества для задачи «{taskLabel}»
          </caption>
          <thead>
            <tr>
              <th scope="col">Модель</th>
              <th scope="col">Размещение</th>
              <th scope="col">Доступ из РФ</th>
              <th scope="col" className="num-col">
                Цена вход / выход за 1 млн токенов
              </th>
              {showFixed ? (
                <th scope="col" className="num-col">
                  Фикс. в месяц
                </th>
              ) : null}
              <th scope="col" className="num-col">
                Контекст
              </th>
              <th scope="col">Возможности</th>
              <th scope="col" className="num-col">
                Качество, экспертно: {taskLabel}
              </th>
              <th scope="col">Проверено</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.id}>
                <th scope="row">
                  <span className="catalog-name">{model.name}</span>
                  {model.profile ? <div className="small"><code>{model.profile.api_model}</code> · <a href={model.profile.pricing_url} target="_blank" rel="noreferrer">Прямой тариф ↗</a><details><summary>Условия тарифа</summary><ul>{model.profile.conditions.map((c) => <li key={c}>{c}</li>)}</ul><p>{model.profile.access_note}</p></details></div> : null}
                  <span className="muted small">
                    {model.vendor} · {TIER_LABELS[model.tier]}
                  </span>
                </th>
                <td>
                  <Badge tone="info">{labelOf(meta.deployments, model.deployment)}</Badge>
                </td>
                <td>
                  <RussiaAccess profile={model.profile} direct={model.ru_access === "direct"} />
                </td>
                <td className="num-col num">
                  {model.pricing.input_per_mtok === 0 && model.pricing.output_per_mtok === 0 ? (
                    "—"
                  ) : (
                    <>
                      {price(model)}
                      <div className="small muted">{taxLabel(model)}</div>
                    </>
                  )}
                </td>
                {showFixed ? (
                  <td className="num-col num">
                    {model.pricing.fixed_monthly > 0
                      ? model.pricing.currency === "USD"
                        ? formatUsd(model.pricing.fixed_monthly)
                        : formatRub(model.pricing.fixed_monthly)
                      : "—"}
                  </td>
                ) : null}
                <td className="num-col num">{contextWindow(model.context_window)}</td>
                <td>
                  <span className="caps">
                    {model.vision ? (
                      <Badge tone="neutral" icon="check">
                        изображения
                      </Badge>
                    ) : null}
                    {model.tool_calling ? (
                      <Badge tone="neutral" icon="check">
                        функции
                      </Badge>
                    ) : null}
                    {!model.vision && !model.tool_calling ? <span className="muted">—</span> : null}
                  </span>
                </td>
                <td className="num-col">
                  <span className="quality" title={`${model.quality[taskType]} из 5`}>
                    {Array.from({ length: 5 }, (_, index) => (
                      <span key={index} className={index < model.quality[taskType] ? "quality__dot quality__dot--on" : "quality__dot"} />
                    ))}
                    <span className="visually-hidden">{model.quality[taskType]} из 5</span>
                  </span>
                </td>
                <td>
                  {formatDate(model.reviewed_at)}
                  {staleIds.has(model.id) ? (
                    <Badge tone="warning" icon="alert" className="row__badge">
                      устарело
                    </Badge>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Disclosure title="Источники тарифов, лимитов и условий доступа"><CatalogSources /></Disclosure>
      <p className="muted small">
        <Icon name="info" size={14} /> Российские тарифы — в рублях с НДС 22&nbsp;%, зарубежные — в долларах без налогов;
        курс для пересчёта — {formatNumber(catalog.data.usd_rub, 2)}&nbsp;₽ за $1. Тарифы стандартные, без кэша,
        асинхронного режима и скидок; DeepSeek — в пиковые часы. Каталог на {formatDate(catalog.data.as_of)}; курс и
        качество — допущения, условия тарифов указаны в карточках моделей.
      </p>
    </div>
  );
}
