import { type ChangeEvent, useMemo, useRef, useState } from "react";
import {
  SAMPLE_CSV_URL,
  createDemoAssessment,
  deleteAssessment,
  getAssessment,
  listAssessments,
  uploadAssessment,
} from "../../api/client";
import type { RowError, StoredAssessment } from "../../api/types";
import { Banner, ErrorBanner } from "../../components/ui/Banner";
import { Button, LinkButton } from "../../components/ui/Button";
import { EmptyState } from "../../components/ui/EmptyState";
import { PageHeader } from "../../components/ui/PageHeader";
import { LoadingRegion, Skeleton, SkeletonCards } from "../../components/ui/Skeleton";
import { useAction } from "../../hooks/useAction";
import { useAsync } from "../../hooks/useAsync";
import { useMeta } from "../../hooks/useMeta";
import { formatBytes, formatCount } from "../../lib/format";
import { AssessmentView } from "./AssessmentView";
import { SavedAssessments } from "./SavedAssessments";

interface ImportReport {
  fileName: string;
  imported: number;
  errors: readonly RowError[];
}

export function AssessmentPage() {
  const meta = useMeta();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removedIds, setRemovedIds] = useState<readonly string[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [demoReset, setDemoReset] = useState(0);

  const saved = useAsync((signal) => listAssessments(50, signal), "assessments");
  const items = useMemo(() => (saved.data ?? []).filter((item) => !removedIds.includes(item.id)), [saved.data, removedIds]);
  // Без явного выбора открывается последняя оценка.
  const activeId = selectedId && !removedIds.includes(selectedId) ? selectedId : (items[0]?.id ?? null);
  const detail = useAsync(activeId ? (signal) => getAssessment(activeId, signal) : null, activeId ?? "none");

  const demo = useAction(createDemoAssessment);
  const upload = useAction((file: File) => uploadAssessment(file));
  const remove = useAction(async (id: string) => {
    await deleteAssessment(id);
    return id;
  });

  const show = (assessment: StoredAssessment) => {
    setSelectedId(assessment.id);
    saved.reload();
  };

  const onDemo = async () => {
    setReport(null);
    const created = await demo.run();
    if (created) {
      setDemoReset((version) => version + 1);
      show(created.assessment);
    }
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReport(null);
    const created = await upload.run(file);
    if (created) {
      show(created.assessment);
      setReport({ fileName: file.name, imported: created.assessment.processes.length, errors: created.parse_errors });
    }
  };

  const onDelete = async (id: string) => {
    const removed = await remove.run(id);
    if (removed) {
      setRemovedIds((previous) => [...previous, removed]);
      setSelectedId((current) => (current === removed ? null : current));
      saved.reload();
    }
  };

  const busy = demo.pending || upload.pending;

  return (
    <>
      <PageHeader
        title="Оценка процессов"
        lead={meta.demo_mode ? "Изучите 18 процессов вымышленной компании: экономию времени, окупаемость, подходящие модели и очередность внедрения." : "Загрузите список процессов компании и получите экономию времени, окупаемость, подходящие модели и очередность внедрения."}
      />

      <section className="card intro" aria-label="Загрузка данных">
        <div className="intro__text">
          <p>
            {meta.demo_mode ? "Оценка уже готова. Откройте «Допущения», измените горизонт или стоимость внедрения и нажмите «Пересчитать». Нажмите на процесс, чтобы увидеть экономику и риски. Кнопка ниже вернёт исходный расчёт." : <>Не знаете, с чего начать? Откройте демо-данные вымышленной компании: 18 процессов поддержки, продаж, HR и
            бухгалтерии. Свои данные загрузите в CSV — обязательны столбцы <code>name</code>, <code>task_type</code>,{" "}
            <code>runs_per_month</code>, <code>minutes_per_run</code>, остальные подставятся по умолчанию.</>}
          </p>
          <p className="muted small">
            {meta.demo_mode ? "Публичное демо: готовая оценка доступна сразу. Можно менять допущения; загрузка и сохранение отключены." : `Файл до ${formatBytes(meta.limits["max_upload_bytes"])}. Данные остаются на этом сервере и никуда не передаются.`}
          </p>
        </div>
        <div className="intro__actions">
          <Button variant="primary" icon="sparkles" loading={demo.pending} disabled={busy} onClick={() => void onDemo()}>
            {meta.demo_mode ? "Вернуть исходный расчёт" : "Загрузить демо-данные"}
          </Button>
          <Button icon="upload" loading={upload.pending} disabled={busy || meta.demo_mode} onClick={() => fileInput.current?.click()}>
            Загрузить CSV
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            hidden
            aria-label="Файл CSV с процессами"
            onChange={(event) => void onFile(event)}
          />
          <LinkButton href={SAMPLE_CSV_URL} icon="download" variant="ghost" download>
            Скачать шаблон CSV
          </LinkButton>
        </div>
      </section>

      {demo.error ? <ErrorBanner error={demo.error} title="Не удалось загрузить демо-данные" /> : null}
      {upload.error ? <ErrorBanner error={upload.error} title="Не удалось загрузить файл" /> : null}
      {remove.error ? <ErrorBanner error={remove.error} title="Не удалось удалить оценку" /> : null}

      {report ? (
        <Banner
          tone={report.errors.length > 0 ? "warning" : "success"}
          title={`Файл «${report.fileName}»: загружено ${formatCount(report.imported, "процесс", "процесса", "процессов")}${
            report.errors.length > 0 ? `, пропущено строк: ${report.errors.length}` : ""
          }`}
          onDismiss={() => setReport(null)}
        >
          {report.errors.length > 0 ? (
            <ul className="banner__list" aria-label="Строки с ошибками">
              {report.errors.slice(0, 20).map((error) => (
                <li key={`${error.line}-${error.message}`}>
                  <strong>строка {error.line}:</strong> {error.message}
                </li>
              ))}
            </ul>
          ) : (
            "Все строки разобраны без ошибок."
          )}
        </Banner>
      ) : null}

      {!meta.demo_mode ? <section className="section" aria-labelledby="saved-title">
        <h2 id="saved-title" className="section__title">
          Сохранённые оценки
        </h2>
        {saved.error ? <ErrorBanner error={saved.error} onRetry={saved.reload} title="Не удалось получить список оценок" /> : null}
        {saved.loading && !saved.data ? (
          <LoadingRegion label="Загружаем сохранённые оценки…">
            <Skeleton height={72} radius={12} />
          </LoadingRegion>
        ) : null}
        {saved.data && items.length === 0 ? (
          <EmptyState icon="chart" title="Пока нет сохранённых оценок">
            Нажмите «Загрузить демо-данные» или загрузите свой CSV — оценка появится здесь.
          </EmptyState>
        ) : null}
        {items.length > 0 ? (
          <SavedAssessments
            items={items}
            activeId={activeId}
            busy={remove.pending}
            onOpen={setSelectedId}
            onDelete={(id) => void onDelete(id)}
          />
        ) : null}
      </section> : null}

      {detail.error ? <ErrorBanner error={detail.error} onRetry={detail.reload} title="Не удалось открыть оценку" /> : null}
      {detail.loading ? (
        <LoadingRegion label="Загружаем оценку…" className="stack">
          <SkeletonCards count={5} height={96} />
          <Skeleton height={320} radius={12} />
        </LoadingRegion>
      ) : null}
      {!detail.loading && detail.data && !detail.error ? (
        <AssessmentView key={`${detail.data.id}:${demoReset}`} stored={detail.data} onSaved={(id) => { setSelectedId(id); saved.reload(); }} />
      ) : null}
    </>
  );
}
