import { useId } from "react";
import type { PromptTemplate } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Icon } from "../../components/ui/Icon";
import { labelOf, useMeta } from "../../hooks/useMeta";
import { cx } from "../../lib/cx";

interface TemplateListProps {
  departments: readonly string[];
  templates: readonly PromptTemplate[];
  selectedId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
}

const matches = (template: PromptTemplate, needle: string) =>
  needle === "" ||
  template.title.toLowerCase().includes(needle) ||
  template.description.toLowerCase().includes(needle) ||
  template.department.toLowerCase().includes(needle);

export function TemplateList({ departments, templates, selectedId, query, onQuery, onSelect }: TemplateListProps) {
  const meta = useMeta();
  const searchId = useId();
  const needle = query.trim().toLowerCase();
  const visible = templates.filter((template) => matches(template, needle));

  return (
    <nav className="tpl-list" aria-label="Шаблоны промптов">
      <div className="search">
        <Icon name="search" size={16} />
        <label className="visually-hidden" htmlFor={searchId}>
          Поиск шаблонов
        </label>
        <input
          id={searchId}
          className="input search__input"
          type="search"
          placeholder="Поиск шаблонов"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
        />
      </div>

      {visible.length === 0 ? <p className="muted small">Ничего не найдено по запросу «{query}».</p> : null}

      {departments.map((department) => {
        const group = visible.filter((template) => template.department === department);
        if (group.length === 0) return null;
        return (
          <section key={department} className="tpl-group" aria-label={department}>
            <h3 className="tpl-group__title">{department}</h3>
            <ul>
              {group.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    className={cx("tpl-item", template.id === selectedId && "tpl-item--active")}
                    aria-current={template.id === selectedId ? "true" : undefined}
                    onClick={() => onSelect(template.id)}
                  >
                    <span className="tpl-item__title">{template.title}</span>
                    <span className="tpl-item__meta">
                      <span className="muted small">{labelOf(meta.task_types, template.task_type)}</span>
                      <Badge tone={template.sensitivity === "personal" || template.sensitivity === "confidential" ? "warning" : "neutral"}>
                        {labelOf(meta.sensitivities, template.sensitivity)}
                      </Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
