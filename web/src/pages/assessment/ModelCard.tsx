import type { ModelPick } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { useMeta, labelOf } from "../../hooks/useMeta";
import { formatNumber, formatRub } from "../../lib/format";

/** Выбранная модель: размещение, качество и разбивка стоимости на переменную и фиксированную части. */
export function ModelCard({ model }: { model: ModelPick }) {
  const meta = useMeta();
  return (
    <div className="model-card">
      <div className="model-card__head">
        <strong>{model.name}</strong>
        <div className="model-card__badges">
          <Badge tone="info">{labelOf(meta.deployments, model.deployment)}</Badge>
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
          <dt>Качество для задачи</dt>
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
        <div>
          <dt>Фиксированная часть</dt>
          <dd className="num">
            {formatRub(model.cost.fixed_rub)}/мес{model.cost.units > 1 ? ` (узлов: ${model.cost.units})` : ""}
          </dd>
        </div>
        <div className="facts__total">
          <dt>Итого на модель</dt>
          <dd className="num">{formatRub(model.cost.total_rub)}/мес</dd>
        </div>
      </dl>
    </div>
  );
}
