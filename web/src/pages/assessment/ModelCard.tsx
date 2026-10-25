import type { ModelPick, Recommendation } from "../../api/types";
import { ModelFacts, RussiaAccess } from "../advisor/RussiaAccess";
import { Badge } from "../../components/ui/Badge";
import { useMeta, labelOf } from "../../hooks/useMeta";
import { formatDollars, formatNumber, formatRub } from "../../lib/format";
import { priceBasis, taxNote } from "../../lib/pricing";

/** Прямой тариф в валюте провайдера; null у моделей без прямого тарифа (например, self-hosted). */
function apiNote(model: ModelPick, profile?: Recommendation["profile"]): string | null {
  const basis = priceBasis(model.cost, profile);
  if (!basis) return null;
  const tariff = model.cost.tariff ? ` · ${model.cost.tariff}` : "";
  if (basis.currency === "USD" && model.cost.total_usd != null) {
    return `API: ${formatDollars(model.cost.total_usd)}/мес ${taxNote(basis)}${tariff}. Пересчёт в рубли — по курсу из допущений.`;
  }
  return `API: ${formatRub(model.cost.total_rub)}/мес ${taxNote(basis)}${tariff}.`;
}

/** Выбранная модель: размещение, качество и разбивка стоимости на переменную и фиксированную части. */
export function ModelCard({ model, profile }: { model: ModelPick; profile?: Recommendation["profile"] }) {
  const meta = useMeta();
  const note = apiNote(model, profile);
  return (
    <div className="model-card">
      <div className="model-card__head">
        <strong>{model.name}</strong>
        <div className="model-card__badges">
          <Badge tone="info">{labelOf(meta.deployments, model.deployment)}</Badge>
          <RussiaAccess profile={profile} direct={model.deployment === "ru_cloud"} />
          {model.requires_masking ? (
            <Badge tone="warning" icon="eye-off">
              нужно обезличивание
            </Badge>
          ) : (
            <Badge tone="success" icon="check">
              обезличивание не требуется
            </Badge>
          )}
        </div>
      </div>
      <dl className="facts">
        <div>
          <dt>Качество для задачи, экспертно</dt>
          <dd className="num">{model.quality} из 5</dd>
        </div>
        <div>
          <dt>Оценка подбора</dt>
          <dd className="num">{formatNumber(model.score, 0)} из 100</dd>
        </div>
        <div>
          <dt>Переменная часть</dt>
          <dd className="num">{formatRub(model.cost.variable_rub)}/мес</dd>
        </div>
        <div className="facts__total">
          <dt>Итого на API</dt>
          <dd className="num">{formatRub(model.cost.total_rub)}/мес</dd>
        </div>
      </dl>
      {profile ? <ModelFacts profile={profile} /> : null}
      {note ? <p className="small muted">{note}</p> : null}
    </div>
  );
}
