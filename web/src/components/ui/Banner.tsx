import type { ReactNode } from "react";
import type { ApiError } from "../../api/errors";
import { cx } from "../../lib/cx";
import { Button } from "./Button";
import { Icon } from "./Icon";
import type { IconName } from "./icons";

type BannerTone = "info" | "warning" | "danger" | "success";

const TONE_ICON: Record<BannerTone, IconName> = {
  info: "info",
  warning: "alert",
  danger: "octagon",
  success: "check-circle",
};

interface BannerProps {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  prominent?: boolean;
  className?: string;
  onDismiss?: () => void;
}

export function Banner({ tone = "info", title, children, actions, prominent, className, onDismiss }: BannerProps) {
  return (
    <div
      className={cx("banner", `banner--${tone}`, prominent && "banner--prominent", className)}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon name={TONE_ICON[tone]} size={20} className="banner__icon" />
      <div className="banner__body">
        {title ? <p className="banner__title">{title}</p> : null}
        {children ? <div className="banner__text">{children}</div> : null}
        {actions ? <div className="banner__actions">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <button type="button" className="banner__close" onClick={onDismiss} aria-label="Закрыть сообщение">
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}

interface ErrorBannerProps {
  error: ApiError;
  onRetry?: () => void;
  title?: string;
}

/** Ошибка запроса: понятный текст, список пунктов (если есть) и кнопка «Повторить». */
export function ErrorBanner({ error, onRetry, title = "Не удалось выполнить запрос" }: ErrorBannerProps) {
  const showList = error.details.length > 0;
  return (
    <Banner
      tone="danger"
      title={showList ? error.summary : title}
      actions={
        onRetry ? (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Повторить
          </Button>
        ) : undefined
      }
    >
      {showList ? (
        <ul className="banner__list">
          {error.details.slice(0, 20).map((line, index) => (
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ul>
      ) : (
        error.message
      )}
    </Banner>
  );
}
