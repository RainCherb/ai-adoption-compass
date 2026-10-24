import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface DrawerProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** Боковая панель-диалог: фокус внутри, Esc и клик по фону закрывают, фокус возвращается на вызвавший элемент. */
export function Drawer({ title, subtitle, onClose, children }: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    // Фокус мог быть на SVG-элементе (пузырёк диаграммы), поэтому проверяем и SVGElement.
    const active = document.activeElement;
    const previous = active instanceof HTMLElement || active instanceof SVGElement ? active : null;
    panelRef.current?.focus({ preventScroll: true });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="drawer__header">
          <div className="drawer__heading">
            <h2 id={titleId} className="drawer__title">
              {title}
            </h2>
            {subtitle ? <div className="drawer__subtitle">{subtitle}</div> : null}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть панель">
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="drawer__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
