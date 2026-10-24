import { getCatalogSources } from "../../api/client";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { useAsync } from "../../hooks/useAsync";
import { formatDate, formatUsd } from "../../lib/format";

export function CatalogSources() {
  const state = useAsync((signal) => getCatalogSources(signal), "catalog-sources");
  if (state.error) return <ErrorBanner error={state.error} onRetry={state.reload} title="Не удалось загрузить источники тарифов" />;
  if (!state.data) return <p role="status">Загружаем источники тарифов…</p>;
  return <section className="stack" aria-labelledby="source-title">
    <h2 id="source-title" className="section__title">Проверяемые источники тарифов и условий</h2>
    <Banner tone="info" title="Отдельно от экспертного каталога">{state.data.disclaimer}</Banner>
    {state.data.sources.map((source) => <article className="card" key={source.id}>
      <h3 className="card__title"><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></h3>
      <p className="muted small">{source.stale ? "Снимок отсутствует или устарел — требуется проверка" : `Получено ${formatDate(source.snapshot?.fetched_at ?? "")}`} · {source.snapshot?.status === "reviewed" ? "Есть заключение ревью" : source.snapshot?.status === "machine_checked" ? "Машинный снимок API" : "Требуется ручная проверка условий"}</p>
      <p>{source.snapshot?.review_note}</p>
      {source.snapshot && !source.stale && source.snapshot.offers.length > 0 ? <div className="table-wrap"><table className="table">
        <caption>Тарифы OpenRouter за 1 млн токенов, стандартный вход / выход; USD, без дополнительных услуг</caption>
        <thead><tr><th scope="col">Модель (точный ID)</th><th scope="col">Вход</th><th scope="col">Выход</th></tr></thead>
        <tbody>{source.snapshot.offers.map((offer) => <tr key={offer.model_id}><th scope="row"><code>{offer.model_id}</code></th><td>{formatUsd(offer.input_per_mtok)}</td><td>{formatUsd(offer.output_per_mtok)}</td></tr>)}</tbody>
      </table></div> : null}
      {source.snapshot ? <details><summary>Контрольная сумма источника</summary><code className="small fingerprint">{source.snapshot.content_sha256}</code></details> : null}
    </article>)}
  </section>;
}
