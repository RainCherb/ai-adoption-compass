import { type KeyboardEvent, type ReactNode, useCallback, useRef, useState } from "react";

export interface TabsState<Id extends string> {
  active: Id;
  visited: readonly Id[];
  select: (id: Id) => void;
}

/** Состояние вкладок: помнит, какие уже открывались, чтобы не терять их содержимое при переключении. */
export function useTabs<Id extends string>(initial: Id): TabsState<Id> {
  const [state, setState] = useState<{ active: Id; visited: readonly Id[] }>({ active: initial, visited: [initial] });
  const select = useCallback(
    (id: Id) =>
      setState((previous) => ({
        active: id,
        visited: previous.visited.includes(id) ? previous.visited : [...previous.visited, id],
      })),
    [],
  );
  return { active: state.active, visited: state.visited, select };
}

interface TabItem<Id extends string> {
  id: Id;
  label: ReactNode;
}

interface TabsProps<Id extends string> {
  tabs: TabsState<Id>;
  items: readonly TabItem<Id>[];
  prefix: string;
  label: string;
}

export function Tabs<Id extends string>({ tabs, items, prefix, label }: TabsProps<Id>) {
  const refs = useRef(new Map<Id, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === tabs.active);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % items.length,
      ArrowLeft: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = items[next];
    if (target) {
      tabs.select(target.id);
      refs.current.get(target.id)?.focus();
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {items.map((item) => {
        const selected = item.id === tabs.active;
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={`${prefix}-tab-${item.id}`}
            aria-selected={selected}
            aria-controls={`${prefix}-panel-${item.id}`}
            tabIndex={selected ? 0 : -1}
            className="tab"
            onClick={() => tabs.select(item.id)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

interface TabPanelProps<Id extends string> {
  tabs: TabsState<Id>;
  id: Id;
  prefix: string;
  children: ReactNode;
}

/** Содержимое монтируется при первом открытии и дальше только прячется. */
export function TabPanel<Id extends string>({ tabs, id, prefix, children }: TabPanelProps<Id>) {
  return (
    <div
      role="tabpanel"
      id={`${prefix}-panel-${id}`}
      aria-labelledby={`${prefix}-tab-${id}`}
      hidden={tabs.active !== id}
      className="tab-panel"
    >
      {tabs.visited.includes(id) ? children : null}
    </div>
  );
}
