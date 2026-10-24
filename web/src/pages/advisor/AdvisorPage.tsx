import { useMemo, useState } from "react";
import { advise } from "../../api/client";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, SkeletonCards } from "../../components/ui/Skeleton";
import { TabPanel, Tabs, useTabs } from "../../components/ui/Tabs";
import { useAsync } from "../../hooks/useAsync";
import { useDebounced } from "../../hooks/useDebounced";
import { useMeta } from "../../hooks/useMeta";
import { formatCount } from "../../lib/format";
import { AdvisorForm } from "./AdvisorForm";
import { CatalogTable } from "./CatalogTable";
import { ExcludedList } from "./ExcludedList";
import { RecommendationCard } from "./RecommendationCard";
import { initialForm, parseForm } from "./workload";

const TOP_DEFAULT = 5;
const TOP_ALL = 20;
const DEBOUNCE_MS = 300;

type AdvisorTab = "advice" | "catalog";

export function AdvisorPage() {
  const meta = useMeta();
  const tabs = useTabs<AdvisorTab>("advice");
  const [form, setForm] = useState(() => initialForm(meta));
  const [top, setTop] = useState(TOP_DEFAULT);

  const live = useMemo(() => parseForm(form), [form]);
  const settled = useDebounced(form, DEBOUNCE_MS);
  const { workload } = useMemo(() => parseForm(settled), [settled]);
  const advice = useAsync(workload ? (signal) => advise(workload, top, signal) : null, workload ? `${JSON.stringify(workload)}|${top}` : "invalid");

  const result = advice.data;
  const eligible = result?.recommendations.length ?? 0;
  const showIllustrative = (result?.data_status ?? meta.catalog.data_status) === "illustrative";

  return (
    <>
      <PageHeader
        title="Подбор моделей"
        lead="Опишите задачу и данные — сервис отберёт подходящие модели по политике данных, качеству, цене и доступности из РФ и объяснит, почему остальные исключены."
      />

      <p><a href="#/models">Основные модели демо: Sonnet 5.5 → GPT‑6.1 Sol → DeepSeek V4.1 Flash. Сравнить прямые тарифы →</a></p>
      <p className="muted small">Ниже — отдельный экспертный каталог для подбора по политике данных и доступу из РФ. Его условные классы не заменяют точные модели и прямые тарифы на главном экране.</p>

      {showIllustrative ? (
        <Banner tone="warning" prominent title="Каталог моделей содержит демонстрационные данные">
          {meta.catalog.disclaimer}
        </Banner>
      ) : null}

      <Tabs
        tabs={tabs}
        prefix="advisor"
        label="Разделы подбора моделей"
        items={[
          { id: "advice", label: "Подбор" },
          { id: "catalog", label: "Каталог" },
        ]}
      />

      <TabPanel tabs={tabs} id="advice" prefix="advisor">
        <div className="advisor-layout">
          <AdvisorForm form={form} errors={live.errors ?? {}} onChange={setForm} />

          <section className="advisor-results" aria-label="Результаты подбора" aria-busy={advice.loading}>
            <h2 className="visually-hidden">Результаты подбора</h2>
            {advice.error ? <ErrorBanner error={advice.error} onRetry={advice.reload} title="Не удалось подобрать модели" /> : null}

            {live.errors ? (
              <EmptyState icon="alert" title="Проверьте параметры">
                Исправьте отмеченные поля — рекомендации обновятся автоматически.
              </EmptyState>
            ) : null}

            {!live.errors && advice.loading && !result ? (
              <LoadingRegion label="Подбираем модели…">
                <SkeletonCards count={3} height={200} />
              </LoadingRegion>
            ) : null}

            {!live.errors && result ? (
              <div className={advice.loading ? "is-refreshing" : undefined}>
                <p className="results-summary" role="status">
                  {eligible > 0
                    ? `Подходит ${formatCount(eligible, "модель", "модели", "моделей")}, исключено: ${result.excluded.length}`
                    : "Подходящих моделей нет"}
                  {" · "}курс {result.usd_rub} ₽/$
                </p>

                {result.notes.length > 0 ? (
                  <Banner tone="info" title="Примечания">
                    <ul className="banner__list">
                      {result.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </Banner>
                ) : null}

                {eligible === 0 ? (
                  <EmptyState icon="ban" title="Ни одна модель не проходит все ограничения">
                    Смягчите требования: снизьте качество, увеличьте бюджет или разрешите другое размещение. Причины исключения —
                    ниже.
                  </EmptyState>
                ) : (
                  <div className="rec-list">
                    {result.recommendations.map((item) => (
                      <RecommendationCard key={item.model_id} item={item} />
                    ))}
                  </div>
                )}

                {eligible >= top && top < TOP_ALL ? (
                  <div className="more">
                    <Button onClick={() => setTop(TOP_ALL)}>Показать все подходящие</Button>
                  </div>
                ) : null}

                <ExcludedList items={result.excluded} defaultOpen={eligible === 0} />
              </div>
            ) : null}
          </section>
        </div>
      </TabPanel>

      <TabPanel tabs={tabs} id="catalog" prefix="advisor">
        <CatalogTable taskType={form.task_type} />
      </TabPanel>
    </>
  );
}
