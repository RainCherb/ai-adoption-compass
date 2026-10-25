import type { ModelOption } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { formatDate, formatDollars, formatRub } from "../../lib/format";
import { reasonKindLabel } from "../../lib/labels";
import { describeTariff, priceBasis } from "../../lib/pricing";
import { RussiaAccess, maxOutputNote } from "./RussiaAccess";

const STANDARD_TARIFF = "Стандартный тариф, без кэша";

export function ModelOptionsTable({ items }: { items: readonly ModelOption[] }) {
  if (!items.length) return null;
  return (
    <section aria-label="Сравнение всех моделей для этой нагрузки" className="stack">
      <h3>Все модели для этой нагрузки</h3>
      <p className="muted small">
        Качество 1–5 — экспертная оценка для типа задачи, а не измеренная точность. Российские тарифы — в рублях с НДС,
        зарубежные — в долларах без налогов; в рубли они пересчитаны по курсу из допущений. Кэш, асинхронный режим и
        скидки не учитываются.
      </p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Стоимость и оценки моделей">
        <table className="table model-options-table">
          <thead>
            <tr>
              <th scope="col">Модель и доступ из РФ</th>
              <th scope="col">Качество</th>
              <th scope="col">Цена за 1 млн токенов, вход / выход</th>
              <th scope="col">В месяц</th>
              <th scope="col">Подходит?</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <OptionRow key={item.model_id} item={item} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OptionRow({ item }: { item: ModelOption }) {
  const { cost, profile } = item;
  const tariff = describeTariff(cost, profile);
  const isUsd = priceBasis(cost, profile)?.currency === "USD";
  return (
    <tr>
      <th scope="row">
        {item.name}
        <div className="small muted">{profile.vendor}</div>
        <RussiaAccess profile={profile} />
      </th>
      <td className="num">{item.quality} / 5</td>
      <td>
        {tariff ?? "—"}
        {cost?.tariff && cost.tariff !== STANDARD_TARIFF ? (
          <div className="small muted">{cost.tariff}</div>
        ) : null}
      </td>
      <td className="num">
        {cost ? (
          <>
            <strong>{formatRub(cost.total_rub)}</strong>
            {isUsd && cost.total_usd != null ? <div className="small muted">{formatDollars(cost.total_usd)}</div> : null}
            {cost.price_warning ? (
              <div className="small cost-warning">
                <Icon name="alert" size={13} /> {cost.price_warning}
              </div>
            ) : null}
          </>
        ) : (
          "Недоступно"
        )}
      </td>
      <td>
        {item.eligible ? (
          <Badge tone="success" icon="check">
            подходит
          </Badge>
        ) : (
          <>
            <Badge tone="danger" icon="close">
              не подходит
            </Badge>
            {item.reasons.length > 0 ? (
              <ul className="model-options__reasons small" title={item.reasons.join("\n")}>
                {(item.kinds?.length ? item.kinds.map(reasonKindLabel) : item.reasons).map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <details>
          <summary>Источник и свойства</summary>
          <p>
            API: <code>{profile.api_model}</code>. Контекст {profile.context_label}. {maxOutputNote(profile)}. Сверено{" "}
            {formatDate(profile.reviewed_at)}.
          </p>
          {item.kinds?.length && item.reasons.length > 0 ? (
            <ul>
              {item.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          <p>{profile.version_note}</p>
          <ul>
            {profile.conditions.map((condition) => (
              <li key={condition}>{condition}</li>
            ))}
          </ul>
          <p>{profile.russia_api_note}</p>
          <p>
            {profile.access_url ? (
              <>
                <a href={profile.access_url} target="_blank" rel="noreferrer">
                  Доступ в России: официальный источник ↗
                </a>{" "}
                ·{" "}
              </>
            ) : null}
            <a href={profile.pricing_url} target="_blank" rel="noreferrer">
              Официальные тарифы ↗
            </a>
          </p>
        </details>
      </td>
    </tr>
  );
}
