import type { ReactNode } from "react";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}

export function EmptyState({ icon = "info", title, children, actions }: EmptyStateProps) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} size={26} />
      </span>
      <h3 className="empty__title">{title}</h3>
      {children ? <div className="empty__text">{children}</div> : null}
      {actions ? <div className="empty__actions">{actions}</div> : null}
    </div>
  );
}
