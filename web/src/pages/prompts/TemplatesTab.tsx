import { useState } from "react";
import { listPrompts } from "../../api/client";
import { ErrorBanner } from "../../components/ui/Banner";
import { EmptyState } from "../../components/ui/EmptyState";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { TemplateDetail } from "./TemplateDetail";
import { TemplateList } from "./TemplateList";

export function TemplatesTab() {
  const prompts = useAsync((signal) => listPrompts(undefined, signal), "prompts");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  if (prompts.error) return <ErrorBanner error={prompts.error} onRetry={prompts.reload} title="Не удалось загрузить шаблоны" />;
  if (!prompts.data) {
    return (
      <LoadingRegion label="Загружаем шаблоны…" className="prompts-layout">
        <Skeleton height={420} radius={12} />
        <Skeleton height={420} radius={12} />
      </LoadingRegion>
    );
  }

  const { templates, departments } = prompts.data;
  if (templates.length === 0) {
    return <EmptyState icon="message" title="Шаблонов пока нет">Библиотека промптов пуста.</EmptyState>;
  }
  // По умолчанию открывается первый шаблон в том порядке, в каком они показаны в списке (по отделам).
  const ordered = [
    ...departments.flatMap((department) => templates.filter((template) => template.department === department)),
    ...templates.filter((template) => !departments.includes(template.department)),
  ];
  const selected = ordered.find((template) => template.id === selectedId) ?? ordered[0];

  return (
    <div className="prompts-layout">
      <TemplateList
        departments={departments}
        templates={templates}
        selectedId={selected?.id ?? null}
        query={query}
        onQuery={setQuery}
        onSelect={setSelectedId}
      />
      {selected ? <TemplateDetail key={selected.id} template={selected} /> : null}
    </div>
  );
}
