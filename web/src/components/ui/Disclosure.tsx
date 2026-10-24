import { type ReactNode, useId, useState } from "react";
import { cx } from "../../lib/cx";
import { Icon } from "./Icon";

interface DisclosureProps {
  title: ReactNode;
  /** Короткая сводка справа от заголовка (счётчик, бейдж). */
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}

/** Сворачиваемая секция с aria-expanded; содержимое остаётся в DOM, чтобы не терять введённые значения. */
export function Disclosure({ title, meta, defaultOpen = false, className, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const regionId = useId();
  return (
    <section className={cx("disclosure", open && "disclosure--open", className)}>
      <h3 className="disclosure__heading">
        <button
          type="button"
          className="disclosure__button"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="chevron-right" size={18} className="disclosure__chevron" />
          <span className="disclosure__title">{title}</span>
          {meta ? <span className="disclosure__meta">{meta}</span> : null}
        </button>
      </h3>
      <div id={regionId} className="disclosure__panel" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
