import type { LintResult } from "../../api/types";
import { ScoreRing } from "../../components/charts/ScoreRing";
import { Badge } from "../../components/ui/Badge";
import { Banner } from "../../components/ui/Banner";
import { Icon } from "../../components/ui/Icon";
import { sensitiveKindLabel } from "../../lib/labels";

const GRADE_TEXT: Record<string, string> = {
  A: "Отличный запрос",
  B: "Хороший запрос",
  C: "Можно лучше",
  D: "Нужна доработка",
};

export function SensitiveChips({ counts }: { counts: Readonly<Record<string, number>> }) {
  const entries = Object.entries(counts);
  if (entries.length === 0) return null;
  return (
    <div className="chips" aria-label="Найденные данные">
      {entries.map(([kind, count]) => (
        <Badge key={kind} tone="warning">
          {sensitiveKindLabel(kind)} × {count}
        </Badge>
      ))}
    </div>
  );
}

/** Итог проверки запроса: большая оценка, критерии с подсказками и список улучшений. */
export function LintResultView({ result }: { result: LintResult }) {
  const hasSensitive = Object.keys(result.sensitive).length > 0;
  return (
    <div className="lint-result" data-testid="lint-result">
      <div className="lint-result__summary">
        <ScoreRing value={result.score} label="Оценка запроса" size={132} center={String(result.score)} />
        <div>
          <p className="lint-result__grade">
            <span className="grade" data-grade={result.grade}>
              {result.grade}
            </span>
            {GRADE_TEXT[result.grade] ?? "Оценка запроса"}
          </p>
          <p className="muted">Слов в запросе: {result.words}</p>
        </div>
      </div>

      {hasSensitive ? (
        <Banner
          tone="warning"
          title={result.capped ? "В запросе есть чувствительные данные — оценка ограничена" : "В запросе есть чувствительные данные"}
        >
          Обезличьте их или выберите допустимый контур на странице «Безопасность данных».
          <SensitiveChips counts={result.sensitive} />
        </Banner>
      ) : null}

      <section aria-labelledby="lint-checks-title">
        <h2 id="lint-checks-title" className="section__subtitle">
          Критерии
        </h2>
        <ul className="checks-list">
          {result.checks.map((check) => (
            <li key={check.id} className="check-item" data-passed={check.passed}>
              <Icon name={check.passed ? "check-circle" : "x-circle"} size={20} />
              <div>
                <p className="check-item__label">
                  <span className="visually-hidden">{check.passed ? "Выполнено: " : "Не выполнено: "}</span>
                  {check.label}
                  <span className="muted small"> · {check.weight} б.</span>
                </p>
                {!check.passed && check.hint ? <p className="check-item__hint">{check.hint}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {result.suggestions.length > 0 ? (
        <section aria-labelledby="lint-suggestions-title">
          <h2 id="lint-suggestions-title" className="section__subtitle">
            Что улучшить
          </h2>
          <ol className="suggestions">
            {result.suggestions.map((suggestion) => (
              <li key={suggestion}>{suggestion}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
