import { useState } from "react";
import { unmaskText } from "../../api/client";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/Banner";
import { CopyButton } from "../../components/ui/CopyButton";
import { Field } from "../../components/ui/Field";
import { useAction } from "../../hooks/useAction";

interface UnmaskBoxProps {
  mapping: Readonly<Record<string, string>> | null | undefined;
  maxChars: number;
}

/** Возвращает реальные значения в ответ модели по меткам [PHONE_1]; соответствия живут только в памяти страницы. */
export function UnmaskBox({ mapping, maxChars }: UnmaskBoxProps) {
  const [answer, setAnswer] = useState("");
  const [restored, setRestored] = useState<string | null>(null);
  const action = useAction((text: string, pairs: Record<string, string>) => unmaskText(text, pairs));
  const keys = mapping ? Object.keys(mapping) : [];

  if (!mapping || keys.length === 0) {
    return <p className="muted">В тексте не было меток обезличивания, возвращать нечего.</p>;
  }

  const run = async () => {
    const text = await action.run(answer, { ...mapping });
    if (text !== undefined) setRestored(text);
  };

  return (
    <div className="unmask">
      <Field
        label="Ответ модели с метками"
        hint={`Метки в тексте: ${keys.join(", ")}. Подставим на их место исходные значения.`}
      >
        {(control) => (
          <textarea
            {...control}
            className="textarea"
            rows={4}
            maxLength={maxChars}
            value={answer}
            placeholder="Вставьте ответ модели, например: «Свяжитесь с клиентом по [PHONE_1]»"
            onChange={(event) => setAnswer(event.target.value)}
          />
        )}
      </Field>
      <div className="row">
        <Button variant="primary" icon="refresh" loading={action.pending} disabled={answer.trim() === ""} onClick={() => void run()}>
          Вернуть значения
        </Button>
        <Button
          variant="ghost"
          onClick={() => setAnswer(`Ответ модели: свяжитесь с клиентом — ${keys.slice(0, 3).join(", ")}.`)}
        >
          Подставить пример ответа
        </Button>
      </div>
      {action.error ? <ErrorBanner error={action.error} /> : null}
      {restored !== null ? (
        <div className="output" data-testid="unmasked">
          <div className="output__head">
            <span className="output__label">Текст с исходными значениями</span>
            <CopyButton text={restored} />
          </div>
          <pre className="output__text">{restored}</pre>
        </div>
      ) : null}
    </div>
  );
}
