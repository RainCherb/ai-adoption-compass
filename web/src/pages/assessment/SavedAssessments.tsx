import type { AssessmentSummary } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { InlineConfirm } from "../../components/ui/InlineConfirm";
import { cx } from "../../lib/cx";
import { formatCount, formatDateTime, formatHours, formatRubCompact } from "../../lib/format";

interface SavedAssessmentsProps {
  items: readonly AssessmentSummary[];
  activeId: string | null;
  busy?: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SavedAssessments({ items, activeId, busy, onOpen, onDelete }: SavedAssessmentsProps) {
  return (
    <ul className="saved-list" aria-label="Сохранённые оценки">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <li key={item.id} className={cx("saved", active && "saved--active")} data-testid="saved-assessment">
            <button type="button" className="saved__open" onClick={() => onOpen(item.id)} aria-current={active ? "true" : undefined}>
              <span className="saved__name">{item.name}</span>
              <span className="saved__meta muted small">
                {formatDateTime(item.created_at)} · {formatCount(item.processes_count, "процесс", "процесса", "процессов")}
              </span>
            </button>
            <dl className="saved__facts">
              <div>
                <dt>Рекомендовано</dt>
                <dd className="num">{item.recommended_count}</dd>
              </div>
              <div>
                <dt>Экономия</dt>
                <dd className="num">{formatHours(item.hours_saved_month, 0)}/мес</dd>
              </div>
              <div>
                <dt>Эффект за период</dt>
                <dd className="num">{formatRubCompact(item.net_horizon_rub)}</dd>
              </div>
            </dl>
            <div className="saved__actions">
              {active ? <Badge tone="accent">открыта</Badge> : null}
              <InlineConfirm
                label="Удалить"
                question={`Удалить «${item.name}»?`}
                disabled={busy}
                onConfirm={() => onDelete(item.id)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
