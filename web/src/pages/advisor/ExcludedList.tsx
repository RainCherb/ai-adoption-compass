import type { Exclusion } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Disclosure } from "../../components/ui/Disclosure";
import { labelOf, useMeta } from "../../hooks/useMeta";

const KIND_LABELS: Record<string, string> = {
  policy: "политика данных",
  access: "доступ из РФ",
  quality: "качество",
  budget: "бюджет",
  vision: "изображения",
  tools: "вызов функций",
  context: "контекст",
};

interface ExcludedListProps {
  items: readonly Exclusion[];
  defaultOpen?: boolean;
}

/** Все исключённые модели с причинами: решение должно быть объяснимым. */
export function ExcludedList({ items, defaultOpen = false }: ExcludedListProps) {
  const meta = useMeta();
  if (items.length === 0) return null;
  return (
    <Disclosure
      title="Исключены"
      meta={<span className="count-pill num">{items.length}</span>}
      defaultOpen={defaultOpen}
      className="excluded"
    >
      <ul className="excluded__list">
        {items.map((item) => (
          <li key={item.model_id} className="excluded__item" data-testid="excluded-model">
            <div className="excluded__head">
              <strong>{item.name}</strong>
              <Badge tone="neutral">{labelOf(meta.deployments, item.deployment)}</Badge>
              {item.kinds.map((kind) => (
                <Badge key={kind} tone="danger">
                  {KIND_LABELS[kind] ?? kind}
                </Badge>
              ))}
            </div>
            <ul className="excluded__reasons">
              {item.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
