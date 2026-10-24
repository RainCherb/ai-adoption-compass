import { type ReactNode, useId } from "react";
import { cx } from "../../lib/cx";

interface ControlProps {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
}

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | undefined;
  className?: string;
  children: (control: ControlProps) => ReactNode;
}

/** Подпись, подсказка и ошибка связаны с полем через for / aria-describedby. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");
  return (
    <div className={cx("field", className)}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy || undefined, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field__error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
