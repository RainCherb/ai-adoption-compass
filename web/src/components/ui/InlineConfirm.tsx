import { useState } from "react";
import { Button } from "./Button";

interface InlineConfirmProps {
  label: string;
  confirmLabel?: string;
  question: string;
  onConfirm: () => void;
  disabled?: boolean;
}

/** Удаление в два шага без модального окна: «Удалить» → «Удалить? Да / Нет». */
export function InlineConfirm({ label, confirmLabel = "Да, удалить", question, onConfirm, disabled }: InlineConfirmProps) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button size="sm" variant="ghost" icon="trash" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <span className="inline-confirm" role="group" aria-label={question}>
      <span className="inline-confirm__question">{question}</span>
      <Button
        size="sm"
        variant="danger"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
        Отмена
      </Button>
    </span>
  );
}
