import type { ModelOption } from "../../api/types";
import { formatNumber, formatRub } from "../../lib/format";

export function ModelOptionsTable({ items }: { items: readonly ModelOption[] }) {
  if (!items.length) return null;
  return <section aria-label="Сравнение трёх базовых моделей" className="stack">
    <h3>Три базовые модели для этой нагрузки</h3>
    <p className="muted small">Качество 1–5 — экспертная оценка для типа задачи. Стоимость рассчитана по одной нагрузке и одному курсу; налоги, кэш и инструменты не включены.</p>
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Стоимость и оценки моделей"><table className="table model-options-table">
      <thead><tr><th>Модель</th><th>Качество, экспертно</th><th>Тариф $ / 1 млн, вход / выход</th><th>В месяц, USD / ₽</th><th>Условия</th></tr></thead>
      <tbody>{items.map((item) => <tr key={item.model_id}>
        <th scope="row">{item.name}<div className="small muted"><code>{item.profile.api_model}</code></div></th>
        <td>{item.quality} / 5</td>
        <td>{item.cost?.input_rate_usd != null ? `${formatNumber(item.cost.input_rate_usd, 3)} / ${formatNumber(item.cost.output_rate_usd, 3)}` : "—"}<div className="small muted">{item.cost?.tariff}</div></td>
        <td>{item.cost?.total_usd != null ? `${formatNumber(item.cost.total_usd, 8)} $ / ${formatRub(item.cost.total_rub)}` : "Недоступно"}</td>
        <td>{item.eligible ? "Проходит выбранные ограничения" : item.reasons.join("; ")}<details><summary>Источник и свойства</summary>
          <p>Контекст {item.profile.context_label}; максимальный выход {formatNumber(item.profile.max_output_tokens)}. Сверено {item.profile.reviewed_at}.</p>
          <p>{item.profile.version_note}</p><ul>{item.profile.conditions.map((c) => <li key={c}>{c}</li>)}</ul>
          <p>{item.profile.access_note}</p><a href={item.profile.pricing_url} target="_blank" rel="noreferrer">Официальные тарифы ↗</a>
        </details></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
