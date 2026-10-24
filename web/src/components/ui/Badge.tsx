import type { ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

interface BadgeProps {
  tone?: Tone;
  icon?: IconName;
  children: ReactNode;
  title?: string;
  className?: string;
}

export function Badge({ tone = "neutral", icon, children, title, className }: BadgeProps) {
  return (
    <span className={cx("badge", `badge--${tone}`, className)} title={title}>
      {icon ? <Icon name={icon} size={13} /> : null}
      {children}
    </span>
  );
}
