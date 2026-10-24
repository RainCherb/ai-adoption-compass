import type { AsyncState } from "../../hooks/useAsync";
import type { Health } from "../../api/types";
import { DATA_STATUS_LABELS } from "../../lib/labels";
import { formatDate } from "../../lib/format";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";

/** Чип статуса каталога из /api/health: демо-данные видно в шапке на любой странице. */
export function StatusChip({ health, label = "Каталог" }: { health: AsyncState<Health>; label?: string }) {
  if (health.error) {
    return (
      <span className="status-chip status-chip--danger" title={health.error.message}>
        <Icon name="octagon" size={14} />
        API недоступен
      </span>
    );
  }
  if (!health.data) return <Skeleton width={190} height={28} radius={999} />;

  const { catalog } = health.data;
  const status = DATA_STATUS_LABELS[catalog.data_status] ?? catalog.data_status;
  const tone = catalog.data_status === "verified" && catalog.stale === 0 ? "success" : "warning";
  return (
    <span className={`status-chip status-chip--${tone}`} data-testid="catalog-status">
      <Icon name="database" size={14} />
      <span>
        <span className="status-chip__prefix">{label}: </span>
        {status}
        <span className="status-chip__date"> · {formatDate(catalog.as_of)}</span>
        {catalog.stale > 0 ? <span> · устарело: {catalog.stale}</span> : null}
      </span>
    </span>
  );
}
