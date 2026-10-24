import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "../../lib/cx";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  icon?: IconName;
  loading?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx("btn", `btn--${variant}`, size === "sm" && "btn--sm", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={size === "sm" ? 15 : 17} /> : null}
      {children}
    </button>
  );
}

interface LinkButtonProps {
  href: string;
  children: ReactNode;
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost";
  size?: "md" | "sm";
  download?: boolean | string;
}

/** Ссылка, оформленная как кнопка (скачивание файлов, переходы). */
export function LinkButton({ href, children, icon, variant = "secondary", size = "md", download }: LinkButtonProps) {
  return (
    <a
      className={cx("btn", `btn--${variant}`, size === "sm" && "btn--sm")}
      href={href}
      download={download === true ? "" : download || undefined}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 15 : 17} /> : null}
      {children}
    </a>
  );
}
