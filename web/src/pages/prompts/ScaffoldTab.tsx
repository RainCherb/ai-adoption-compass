import { useState } from "react";
import { scaffoldPrompt } from "../../api/client";
import { Button } from "../../components/ui/Button";
import { ErrorBanner } from "../../components/ui/Banner";
import { CopyButton } from "../../components/ui/CopyButton";
import { Field } from "../../components/ui/Field";
import { useAction } from "../../hooks/useAction";

interface ScaffoldTabProps {
  onLint: (text: string) => void;
}

export function ScaffoldTab({ onLint }: ScaffoldTabProps) {
  const [task, setTask] = useState("");
  const [role, setRole] = useState("");
  const [scaffold, setScaffold] = useState<string | null>(null);
  const action = useAction((taskText: string, roleText: string) => scaffoldPrompt(taskText, roleText.trim() || undefined));
  const valid = task.trim().length >= 3;

  const build = async () => {
    const text = await action.run(task.trim(), role);
    if (text !== undefined) setScaffold(text);
  };

  return (
    <div className="stack">
      <form
        className="card"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void build();
        }}
      >
        <Field label="Задача" hint="Одним предложением: что должна сделать модель (от 3 до 500 символов)">
          {(control) => (
            <input
              {...control}
              className="input"
              type="text"
              maxLength={500}
              value={task}
              placeholder="Например: составить ответ на жалобу клиента о задержке доставки"
              onChange={(event) => setTask(event.target.value)}
            />
          )}
        </Field>
        <Field label="Роль (необязательно)" hint="Кем «притворяется» модель: например, менеджер поддержки">
          {(control) => (
            <input
              {...control}
              className="input"
              type="text"
              maxLength={120}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            />
          )}
        </Field>
        <div className="row">
          <Button type="submit" variant="primary" icon="sparkles" loading={action.pending} disabled={!valid}>
            Собрать каркас
          </Button>
        </div>
      </form>

      {action.error ? <ErrorBanner error={action.error} title="Не удалось собрать каркас" /> : null}

      {scaffold !== null ? (
        <section className="card" aria-labelledby="scaffold-title">
          <div className="output__head">
            <h2 id="scaffold-title" className="section__subtitle">
              Каркас запроса
            </h2>
            <div className="row">
              <CopyButton text={scaffold} />
              <Button size="sm" icon="check-circle" onClick={() => onLint(scaffold)}>
                Проверить
              </Button>
            </div>
          </div>
          <pre className="output__text" data-testid="scaffold-text">
            {scaffold}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
