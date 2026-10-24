import type { Flag, Severity } from "../../api/types";
import { Icon } from "../../components/ui/Icon";
import type { IconName } from "../../components/ui/icons";
import { SEVERITY_LABELS } from "../../lib/labels";

const SEVERITY_ICON: Record<Severity, IconName> = {
  info: "info",
  warning: "alert",
  critical: "octagon",
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Флаги расчёта: уровень передан значком и подписью, а не только цветом. */
export function FlagList({ flags }: { flags: readonly Flag[] }) {
  if (flags.length === 0) return <p className="muted">Замечаний нет.</p>;
  const ordered = [...flags].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return (
    <ul className="flags">
      {ordered.map((flag) => (
        <li key={flag.code} className="flag" data-severity={flag.severity}>
          <Icon name={SEVERITY_ICON[flag.severity]} size={18} className="flag__icon" />
          <div>
            <span className="flag__severity">{SEVERITY_LABELS[flag.severity]}</span>
            <p className="flag__message">{flag.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
