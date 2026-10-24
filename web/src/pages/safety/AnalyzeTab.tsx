import { useMemo, useState } from "react";
import { analyzeText } from "../../api/client";
import type { AnalyzeResponse, Sensitivity } from "../../api/types";
import { Badge } from "../../components/ui/Badge";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { CopyButton } from "../../components/ui/CopyButton";
import { Disclosure } from "../../components/ui/Disclosure";
import { Field } from "../../components/ui/Field";
import { LoadingRegion, Skeleton } from "../../components/ui/Skeleton";
import { useAsync } from "../../hooks/useAsync";
import { useDebounced } from "../../hooks/useDebounced";
import { labelOf, useMeta } from "../../hooks/useMeta";
import { formatCount } from "../../lib/format";
import { CONFIDENCE_LABELS, sensitiveKindLabel } from "../../lib/labels";
import { DecisionCards } from "./DecisionCards";
import { HighlightedText } from "./HighlightedText";
import { SAMPLE_PERSONAL, SAMPLE_SECRET } from "./samples";
import { UnmaskBox } from "./UnmaskBox";

const LIVE_DEBOUNCE_MS = 600;

interface Analysis {
  text: string;
  response: AnalyzeResponse;
}

interface Input {
  text: string;
  declared: Sensitivity;
}

function Result({ analysis, maxChars }: { analysis: Analysis; maxChars: number }) {
  const meta = useMeta();
  const { text, response } = analysis;
  const kinds = useMemo(() => {
    const labels = new Map(response.findings.map((finding) => [finding.kind, finding.label]));
    return Object.entries(response.counts).map(([kind, count]) => ({ kind, count, label: labels.get(kind) ?? sensitiveKindLabel(kind) }));
  }, [response]);

  return (
    <div className="stack" data-testid="analysis-result">
      <div className="result-summary">
        <div className="chips" aria-label="Найдено по типам">
          <Badge tone={response.findings.length > 0 ? "warning" : "success"}>
            {response.findings.length > 0 ? `Найдено: ${response.findings.length}` : "Ничего не найдено"}
          </Badge>
          {kinds.map((item) => (
            <Badge key={item.kind} tone="neutral">
              {item.label} × {item.count}
            </Badge>
          ))}
          {response.has_secrets ? (
            <Badge tone="danger" icon="octagon">
              найдены секреты
            </Badge>
          ) : null}
        </div>
        <dl className="facts facts--inline">
          <div>
            <dt>Заявлено</dt>
            <dd>{labelOf(meta.sensitivities, response.declared_sensitivity)}</dd>
          </div>
          <div>
            <dt>Обнаружено</dt>
            <dd>{response.detected_sensitivity ? labelOf(meta.sensitivities, response.detected_sensitivity) : "—"}</dd>
          </div>
          <div>
            <dt>Итоговая категория</dt>
            <dd>
              <strong>{labelOf(meta.sensitivities, response.effective_sensitivity)}</strong>
            </dd>
          </div>
        </dl>
      </div>

      {response.findings.length === 0 ? (
        <Banner tone="success" title="Персональные данные и секреты не найдены">
          Автоматический поиск ничего не нашёл. Это не гарантия: проверьте текст глазами, если он важен.
        </Banner>
      ) : null}

      <section aria-labelledby="highlight-title">
        <h2 id="highlight-title" className="section__subtitle">
          Текст с находками
        </h2>
        <HighlightedText text={text} findings={response.findings} />
      </section>

      {response.findings.length > 0 ? (
        <Disclosure title="Список находок" meta={<span className="count-pill num">{response.findings.length}</span>}>
          <div className="table-wrap">
            <table className="table table--compact">
              <thead>
                <tr>
                  <th scope="col">Тип</th>
                  <th scope="col">Фрагмент (скрыт)</th>
                  <th scope="col">Уверенность</th>
                  <th scope="col">Категория</th>
                </tr>
              </thead>
              <tbody>
                {response.findings.map((finding) => (
                  <tr key={`${finding.start}-${finding.end}`}>
                    <th scope="row">
                      {finding.label}
                      {finding.is_secret ? <Badge tone="danger" className="row__badge">секрет</Badge> : null}
                    </th>
                    <td>
                      <code>{finding.preview}</code>
                    </td>
                    <td>{CONFIDENCE_LABELS[finding.confidence] ?? finding.confidence}</td>
                    <td>{labelOf(meta.sensitivities, finding.implied_sensitivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Disclosure>
      ) : null}

      <section aria-labelledby="decisions-title">
        <h2 id="decisions-title" className="section__subtitle">
          Куда можно отправлять этот текст
        </h2>
        <DecisionCards decisions={response.decisions} />
      </section>

      <section aria-labelledby="masked-title">
        <div className="output__head">
          <h2 id="masked-title" className="section__subtitle">
            Обезличенный текст
          </h2>
          <CopyButton text={response.masked_text} />
        </div>
        <pre className="output__text" data-testid="masked-text">
          {response.masked_text}
        </pre>
      </section>

      <section aria-labelledby="unmask-title">
        <h2 id="unmask-title" className="section__subtitle">
          Ответ модели → вернуть значения
        </h2>
        <UnmaskBox mapping={response.mapping} maxChars={maxChars} />
      </section>
    </div>
  );
}

export function AnalyzeTab() {
  const meta = useMeta();
  const maxChars = meta.limits["max_text_chars"] ?? 200_000;
  const [text, setText] = useState("");
  const [declared, setDeclared] = useState<Sensitivity>("internal");
  const [live, setLive] = useState(true);
  const [submitted, setSubmitted] = useState<Input | null>(null);

  const debounced = useDebounced<Input>({ text, declared }, LIVE_DEBOUNCE_MS);
  // Явное нажатие «Проверить» срабатывает сразу; при вводе в живом режиме действует задержка.
  const matchesSubmitted = submitted !== null && submitted.text === text && submitted.declared === declared;
  const source = live ? (matchesSubmitted ? submitted : debounced) : submitted;
  const request = source && source.text.trim() !== "" ? source : null;

  const analysis = useAsync<Analysis>(
    request
      ? (signal) =>
          analyzeText(
            { text: request.text, declared_sensitivity: request.declared, include_mapping: true },
            signal,
          ).then((response) => ({ text: request.text, response }))
      : null,
    request ? `${request.declared}:${request.text}` : "empty",
  );

  const insert = (sample: string) => {
    setText(sample);
    setSubmitted({ text: sample, declared });
  };

  return (
    <div className="safety-analyze">
      <div className="card analyze-input">
        <Field
          label="Текст для проверки"
          hint={`До ${formatCount(maxChars, "символа", "символов", "символов")}. Текст обрабатывается локально и не сохраняется: в журнале остаются только метаданные.`}
        >
          {(control) => (
            <textarea
              {...control}
              className="textarea textarea--lg"
              rows={7}
              maxLength={maxChars}
              value={text}
              placeholder="Вставьте письмо, обращение клиента или фрагмент документа…"
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>

        <div className="analyze-controls">
          <Field label="Категория данных (заявленная)">
            {(control) => (
              <select
                {...control}
                className="select"
                value={declared}
                onChange={(event) => setDeclared(event.target.value as Sensitivity)}
              >
                {meta.sensitivities.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <label className="check">
            <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
            <span>Проверять при вводе</span>
          </label>
        </div>

        <div className="row">
          <Button
            variant="primary"
            icon="shield"
            loading={analysis.loading && request !== null}
            disabled={text.trim() === ""}
            onClick={() => setSubmitted({ text, declared })}
          >
            Проверить
          </Button>
          <Button icon="sparkles" onClick={() => insert(SAMPLE_PERSONAL)}>
            Вставить пример
          </Button>
          <Button variant="ghost" onClick={() => insert(SAMPLE_SECRET)}>
            Пример с секретом
          </Button>
          <Button variant="ghost" disabled={text === ""} onClick={() => { setText(""); setSubmitted(null); }}>
            Очистить
          </Button>
        </div>
      </div>

      {analysis.error ? <ErrorBanner error={analysis.error} onRetry={analysis.reload} title="Не удалось проверить текст" /> : null}
      {request === null && !analysis.error ? (
        <p className="muted placeholder">Вставьте текст или нажмите «Вставить пример» — найденные данные подсветятся здесь.</p>
      ) : null}
      {request !== null && analysis.loading && !analysis.data ? (
        <LoadingRegion label="Проверяем текст…">
          <Skeleton height={160} radius={12} />
        </LoadingRegion>
      ) : null}
      {request !== null && analysis.data ? (
        <div className={analysis.loading ? "is-refreshing" : undefined}>
          <Result analysis={analysis.data} maxChars={maxChars} />
        </div>
      ) : null}
    </div>
  );
}
