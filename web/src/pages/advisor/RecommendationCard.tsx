import type { Recommendation } from "../../api/types";
import { ScoreBar } from "../../components/charts/ScoreBar";
import { ScoreRing } from "../../components/charts/ScoreRing";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { labelOf, useMeta } from "../../hooks/useMeta";
import { formatPercent, formatRub, formatNumber } from "../../lib/format";
import { TIER_LABELS } from "../../lib/labels";
import { ModelFacts, RussiaAccess } from "./RussiaAccess";

const BREAKDOWN: readonly {
  key: keyof Recommendation["breakdown"];
  label: string;
  hint: string;
}[] = [
  {
    key: "quality",
    label: "Качество",
    hint: "соответствие требуемому качеству для задачи",
  },
  {
    key: "cost",
    label: "Стоимость",
    hint: "чем дешевле среди подходящих, тем выше",
  },
  {
    key: "safety",
    label: "Безопасность",
    hint: "размещение данных и требования политики",
  },
  {
    key: "access",
    label: "Условия доступа",
    hint: "соответствие выбранным условиям аккаунта и оплаты; регион РФ указан отдельным статусом",
  },
];

export function RecommendationCard({ item }: { item: Recommendation }) {
  const meta = useMeta();
  return (
    <article
      className="rec"
      data-testid="recommendation"
      aria-label={`${item.rank}. ${item.name}`}
    >
      <header className="rec__head">
        <span className="rec__rank" aria-hidden="true">
          {item.rank}
        </span>
        <div className="rec__title">
          <h3>{item.name}</h3>
          <p className="muted small">
            {item.vendor} · {TIER_LABELS[item.tier]}
          </p>
          <div className="rec__badges">
            <Badge tone="info">
              {labelOf(meta.deployments, item.deployment)}
            </Badge>
            <RussiaAccess
              profile={item.profile}
              direct={item.ru_access === "direct"}
            />
            {item.requires_masking ? (
              <Badge tone="warning" icon="eye-off">
                нужно обезличивание
              </Badge>
            ) : null}
          </div>
        </div>
        <ScoreRing
          value={item.score}
          label={`Итоговая оценка «${item.name}»`}
          size={68}
          caption={item.profile ? "экспертно" : "оценка"}
        />
      </header>

      <div className="rec__body">
        <div className="rec__cost">
          <span className="rec__cost-label">Стоимость в месяц</span>
          <strong className="rec__cost-value num">
            {formatRub(item.cost.total_rub)}
          </strong>
          <span className="muted small num">
            {item.profile ? (
              `${formatNumber(item.cost.requests_per_month)} запросов · только API`
            ) : (
              <>
                переменная {formatRub(item.cost.variable_rub)} + фиксированная{" "}
                {formatRub(item.cost.fixed_rub)}
              </>
            )}
          </span>
          <span className="muted small">
            Качество для задачи: {item.quality} из 5
          </span>
          {item.profile ? (
            <>
              <span className="muted small">
                Экспертная оценка, не собственный benchmark
              </span>
              <span className="small">
                {formatNumber(item.cost.total_usd, 8)} $/мес. ·{" "}
                {item.cost.tariff}
              </span>
              <span className="small">
                Контекст {item.profile.context_label} ·{" "}
                <code>{item.profile.api_model}</code>
              </span>
              <a
                className="small"
                href={item.profile.pricing_url}
                target="_blank"
                rel="noreferrer"
              >
                Прямой тариф и условия ↗
              </a>
            </>
          ) : null}
        </div>
        <div className="rec__breakdown">
          {BREAKDOWN.map(({ key, label, hint }) => (
            <ScoreBar
              key={key}
              label={label}
              hint={hint}
              value={item.breakdown[key] * 100}
              valueText={formatPercent(item.breakdown[key])}
            />
          ))}
        </div>
      </div>

      {item.profile ? <ModelFacts profile={item.profile} /> : null}
      <div className="rec__lists">
        <ul className="pros" aria-label="Плюсы">
          {item.pros.map((text) => (
            <li key={text}>
              <Icon name="check" size={15} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
        <ul className="cons" aria-label="Ограничения">
          {item.cons.map((text) => (
            <li key={text}>
              <Icon name="alert" size={15} />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
