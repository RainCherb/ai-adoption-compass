import { useState } from "react";
import { lintPrompt } from "../../api/client";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/Banner";
import { Field } from "../../components/ui/Field";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { useMeta } from "../../hooks/useMeta";
import { LintResultView } from "./LintResultView";

const WEAK_EXAMPLE = "Напиши письмо клиенту про задержку заказа. Звонить на 89123456789";

interface LintTabProps {
  initialText?: string;
  /** Запустить проверку сразу при открытии (переход из каркаса). */
  autorun?: boolean;
}

export function LintTab({ initialText = "", autorun = false }: LintTabProps) {
  const meta = useMeta();
  const maxChars = meta.limits["max_text_chars"] ?? 200_000;
  const [text, setText] = useState(initialText);
  const [submitted, setSubmitted] = useState<string | null>(autorun && initialText.trim() ? initialText : null);

  const lint = useAsync(submitted !== null ? (signal) => lintPrompt(submitted, signal) : null, submitted ?? "none");

  return (
    <div className="stack">
      <div className="card">
        <Field label="Текст запроса к модели" hint="Проверим роль, задачу, контекст, формат, ограничения, примеры и защиту от инъекций">
          {(control) => (
            <textarea
              {...control}
              className="textarea textarea--lg"
              rows={8}
              maxLength={maxChars}
              value={text}
              placeholder="Вставьте промпт, который хотите проверить…"
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
        <div className="row">
          <Button variant="primary" icon="check-circle" disabled={text.trim() === ""} loading={lint.loading} onClick={() => setSubmitted(text)}>
            Проверить запрос
          </Button>
          <Button variant="ghost" onClick={() => setText(WEAK_EXAMPLE)}>
            Вставить слабый пример
          </Button>
        </div>
      </div>

      {lint.error ? <ErrorBanner error={lint.error} onRetry={lint.reload} title="Не удалось проверить запрос" /> : null}
      {lint.loading && !lint.data ? (
        <LoadingRegion label="Проверяем запрос…">
          <Skeleton height={220} radius={12} />
        </LoadingRegion>
      ) : null}
      {lint.data ? (
        <div className={lint.loading ? "is-refreshing card" : "card"}>
          <LintResultView result={lint.data} />
        </div>
      ) : null}
    </div>
  );
}
