import { useId, useMemo, useState } from "react";
import { getAudit } from "../../api/client";
import type { AuditEvent } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, SkeletonLines } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { formatDateTime } from "../../lib/format";
import { AUDIT_KEY_LABELS, AUDIT_KIND_LABELS } from "../../lib/labels";

const LIMIT = 100;

function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "да" : "нет";
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, inner]) => `${key}=${formatValue(inner)}`)
      .join(", ");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "—";
}

const kindTone = (kind: string) =>
  kind.startsWith("safety") ? "warning" : kind.startsWith("assessment") ? "accent" : kind.startsWith("prompt") ? "info" : "neutral";

function PayloadChips({ payload }: { payload: AuditEvent["payload"] }) {
  const entries = Object.entries(payload);
  if (entries.length === 0) return <span className="muted">—</span>;
  return (
    <ul className="payload">
      {entries.map(([key, value]) => (
        <li key={key} className="payload__chip">
          <span className="payload__key">{AUDIT_KEY_LABELS[key] ?? key}:</span> <span className="num">{formatValue(value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function AuditPage() {
  const selectId = useId();
  const [kind, setKind] = useState("");
  const events = useAsync((signal) => getAudit(LIMIT, kind || undefined, signal), `audit:${kind}`);

  const kinds = useMemo(() => {
    const result = new Set(Object.keys(AUDIT_KIND_LABELS));
    for (const event of events.data ?? []) result.add(event.kind);
    if (kind) result.add(kind);
    return [...result].sort();
  }, [events.data, kind]);

  return (
    <>
      <PageHeader
        title="Журнал"
        lead="Что происходило в сервисе: создание оценок, проверки текстов и промптов. Журнал нужен для аудита и разбора инцидентов."
      />

      <Banner tone="info" title="Здесь только метаданные">
        <Icon name="lock" size={14} /> Тексты, персональные данные и найденные значения в журнал не попадают — только число символов, типы
        находок и принятые решения.
      </Banner>

      <section className="card" aria-labelledby="audit-title">
        <header className="card__header">
          <h2 id="audit-title" className="card__title">
            События
          </h2>
          <div className="toolbar">
            <div className="field field--inline nowrap">
              <label className="field__label" htmlFor={selectId}>
                Тип события
              </label>
              <select id={selectId} className="select" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="">Все события</option>
                {kinds.map((item) => (
                  <option key={item} value={item}>
                    {AUDIT_KIND_LABELS[item] ?? item}
                  </option>
                ))}
              </select>
            </div>
            <Button icon="refresh" loading={events.loading && events.data !== undefined} onClick={events.reload}>
              Обновить
            </Button>
          </div>
        </header>

        {events.error ? <ErrorBanner error={events.error} onRetry={events.reload} title="Не удалось загрузить журнал" /> : null}
        {events.loading && !events.data ? (
          <LoadingRegion label="Загружаем журнал…">
            <SkeletonLines lines={6} />
          </LoadingRegion>
        ) : null}

        {events.data && events.data.length === 0 ? (
          <EmptyState icon="list" title="Событий пока нет">
            Загрузите демо-данные, проверьте текст или соберите промпт — события появятся здесь.
          </EmptyState>
        ) : null}

        {events.data && events.data.length > 0 ? (
          <div className={events.loading ? "table-wrap is-refreshing" : "table-wrap"} tabIndex={0} role="region" aria-label="Журнал событий">
            <table className="table" data-testid="audit-table">
              <caption className="visually-hidden">Последние события журнала</caption>
              <thead>
                <tr>
                  <th scope="col">Время</th>
                  <th scope="col">Событие</th>
                  <th scope="col">Данные</th>
                </tr>
              </thead>
              <tbody>
                {events.data.map((event) => (
                  <tr key={event.id} data-testid="audit-row">
                    <td className="nowrap num">{formatDateTime(event.ts)}</td>
                    <td>
                      <Badge tone={kindTone(event.kind)} title={event.kind}>
                        {AUDIT_KIND_LABELS[event.kind] ?? event.kind}
                      </Badge>
                    </td>
                    <td>
                      <PayloadChips payload={event.payload} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {events.data && events.data.length > 0 ? (
          <p className="muted small">Показаны последние {Math.min(events.data.length, LIMIT)} событий.</p>
        ) : null}
      </section>
    </>
  );
}
