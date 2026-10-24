import type { Action, Decision } from "../../api/types";
import { Badge, type Tone } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/icons";
import { labelOf, useMeta } from "../../hooks/useMeta";

export const ACTION_STYLE: Record<Action, { tone: Tone; icon: IconName }> = {
  allow: { tone: "success", icon: "check-circle" },
  mask: { tone: "warning", icon: "eye-off" },
  deny: { tone: "danger", icon: "x-circle" },
};

const TARGET_ICON: Record<string, IconName> = {
  ru_cloud: "database",
  foreign_cloud: "external",
  self_hosted: "server",
};

/** Решение для каждого контура: можно / после обезличивания / нельзя — со значком, подписью и причинами. */
export function DecisionCards({ decisions }: { decisions: readonly Decision[] }) {
  const meta = useMeta();
  return (
    <div className="decisions">
      {decisions.filter((decision) => decision.target !== "self_hosted").map((decision) => {
        const style = ACTION_STYLE[decision.action];
        return (
          <article key={decision.target} className="decision" data-action={decision.action} data-testid="decision-card">
            <header className="decision__head">
              <Icon name={TARGET_ICON[decision.target] ?? "server"} size={20} />
              <h3>{labelOf(meta.deployments, decision.target)}</h3>
            </header>
            <Badge tone={style.tone} icon={style.icon} className="decision__badge">
              {labelOf(meta.actions, decision.action)}
            </Badge>
            {decision.reasons.length > 0 ? (
              <ul className="decision__reasons">
                {decision.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Ограничений по найденным данным нет.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
