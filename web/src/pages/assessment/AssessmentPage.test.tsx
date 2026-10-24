import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { AssessmentRequest, StoredAssessment } from "../../api/types";
import { assessmentResult, defaultAssumptions, processes, savedSummary, stored } from "../../test/fixtures";
import { mockFetch, reply } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { AssessmentPage } from "./AssessmentPage";

const whatIfResult = {
  ...assessmentResult,
  assumptions: { ...defaultAssumptions, horizon_months: 24 },
  summary: { ...assessmentResult.summary, net_horizon_rub: 9_876_543 },
};

/** Хранилище в памяти: список оценок меняется после создания и удаления, как у настоящего API. */
function setup(options: { saved?: boolean } = {}) {
  let list = options.saved ? [savedSummary] : [];
  const api = mockFetch([
    { path: "/api/assessments", handle: () => list },
    {
      method: "POST",
      path: "/api/assessments/demo",
      handle: () => {
        list = [savedSummary];
        return reply(201, { assessment: stored, parse_errors: [] });
      },
    },
    {
      method: "POST",
      path: "/api/assessments/upload",
      handle: () => {
        list = [savedSummary];
        return reply(201, {
          assessment: stored,
          parse_errors: [{ line: 3, message: "task_type: неизвестное значение «wrong»" }],
        });
      },
    },
    { path: "/api/assessments/a1", reply: stored },
    { path: /^\/api\/assessments\/a2$/, reply: { ...stored, id: "a2", name: "Демо (что-если)" } },
    { method: "POST", path: "/api/assess", reply: whatIfResult },
    {
      method: "POST",
      path: "/api/assessments",
      handle: () => reply(201, { ...stored, id: "a2", name: "Демо: ООО «Ромашка» (что-если)" } satisfies StoredAssessment),
    },
    {
      method: "DELETE",
      path: "/api/assessments/a1",
      handle: () => {
        list = [];
        return reply(204);
      },
    },
  ]);
  renderWithMeta(<AssessmentPage />);
  return api;
}

const kpiList = () => within(screen.getByRole("list", { name: "Ключевые показатели" }));
const rowButton = (name: string) =>
  within(screen.getAllByTestId("process-row").find((row) => within(row).queryByText(name)) as HTMLElement).getByRole("button", { name });

async function openDemo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Загрузить демо-данные" }));
  await screen.findAllByTestId("process-row");
}

describe("AssessmentPage: загрузка данных", () => {
  it("без оценок показывает подсказку, а кнопка «демо» создаёт оценку и открывает таблицу", async () => {
    const user = userEvent.setup();
    const api = setup();
    expect(await screen.findByText("Пока нет сохранённых оценок")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Скачать шаблон CSV" })).toHaveAttribute("href", "/api/samples/processes.csv");

    await openDemo(user);
    expect(api.callsTo("POST", "/api/assessments/demo")).toHaveLength(1);
    const rows = screen.getAllByTestId("process-row");
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText("Маршрутизация обращений")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Демо: ООО «Ромашка»" })).toBeInTheDocument();
  });

  it("показывает показатели, предупреждения, план внедрения без локальной инфраструктуры", async () => {
    const user = userEvent.setup();
    setup();
    await openDemo(user);

    const kpis = kpiList();
    expect(kpis.getByText("326 ч/мес")).toBeInTheDocument();
    expect(kpis.getByText(/≈ 2 FTE/)).toBeInTheDocument();
    expect(kpis.getByText("2,4 млн ₽")).toBeInTheDocument();
    expect(kpis.getByText("Эффект за 12 мес.")).toBeInTheDocument();
    expect(kpis.getByText("2,3 мес.")).toBeInTheDocument();
    expect(kpis.getByText("155 %")).toBeInTheDocument();

    expect(screen.getByText("Каталог моделей содержит демонстрационные цены.")).toBeInTheDocument();
    const waves = screen.getAllByTestId("roadmap-wave");
    expect(waves).toHaveLength(2);
    expect(within(waves[0] as HTMLElement).getByRole("button", { name: "Маршрутизация обращений" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Собственная инфраструктура/ })).not.toBeInTheDocument();
  });

  it("разбор CSV: показывает строки с ошибками из parse_errors", async () => {
    const user = userEvent.setup();
    const api = setup();
    const file = new File(["id,name\n"], "processes.csv", { type: "text/csv" });
    await user.upload(await screen.findByLabelText("Файл CSV с процессами"), file);

    expect(await screen.findByText(/Файл «processes.csv»: загружено 3 процесса, пропущено строк: 1/)).toBeInTheDocument();
    const errors = screen.getByRole("list", { name: "Строки с ошибками" });
    expect(within(errors).getByText(/строка 3:/)).toBeInTheDocument();
    expect(within(errors).getByText(/неизвестное значение/)).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/assessments/upload")).toHaveLength(1);
    expect(api.callsTo("POST", "/api/assessments/upload")[0]?.body).toBeInstanceOf(FormData);
  });

  it("ошибка API при загрузке файла превращается в читаемый баннер", async () => {
    const user = userEvent.setup();
    mockFetch([
      { path: "/api/assessments", reply: [] },
      {
        method: "POST",
        path: "/api/assessments/upload",
        reply: reply(422, { detail: { message: "В файле нет ни одной корректной строки", errors: [{ line: 2, message: "name: пусто" }] } }),
      },
    ]);
    renderWithMeta(<AssessmentPage />);
    await user.upload(await screen.findByLabelText("Файл CSV с процессами"), new File(["x"], "bad.csv", { type: "text/csv" }));
    expect(await screen.findByText("В файле нет ни одной корректной строки")).toBeInTheDocument();
    expect(screen.getByText("строка 2: name: пусто")).toBeInTheDocument();
  });

  it("сохранённая оценка открывается автоматически, удаление требует подтверждения", async () => {
    const user = userEvent.setup();
    const api = setup({ saved: true });
    expect(await screen.findAllByTestId("process-row")).toHaveLength(3);
    expect(screen.getByText("открыта")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(api.callsTo("DELETE", "/api/assessments/a1")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Да, удалить" }));

    await waitFor(() => expect(api.callsTo("DELETE", "/api/assessments/a1")).toHaveLength(1));
    expect(await screen.findByText("Пока нет сохранённых оценок")).toBeInTheDocument();
    expect(screen.queryByTestId("process-row")).toBeNull();
  });
});

describe("AssessmentPage: таблица процессов", () => {
  it("фильтр-чипы по квадрантам и поиск сужают список", async () => {
    const user = userEvent.setup();
    setup();
    await openDemo(user);

    const filters = within(screen.getByRole("group", { name: "Фильтр по квадрантам" }));
    await user.click(filters.getByRole("button", { name: /Стратегический проект/ }));
    expect(filters.getByRole("button", { name: /Стратегический проект/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("process-row")).toHaveLength(1);
    expect(screen.getByText("Показано 1 из 3. Строка открывает подробный расчёт.")).toBeInTheDocument();
    await user.click(filters.getByRole("button", { name: "Сбросить" }));
    expect(screen.getAllByTestId("process-row")).toHaveLength(3);

    await user.type(screen.getByLabelText("Поиск по процессам"), "юристы");
    expect(screen.getAllByTestId("process-row")).toHaveLength(1);
    await user.clear(screen.getByLabelText("Поиск по процессам"));
    await user.type(screen.getByLabelText("Поиск по процессам"), "нет такого");
    expect(screen.getByText("Ничего не найдено")).toBeInTheDocument();
  });

  it("сортировка по клику на заголовок: направление отражено в aria-sort, пустые значения всегда внизу", async () => {
    const user = userEvent.setup();
    setup();
    await openDemo(user);
    const names = () => screen.getAllByTestId("process-row").map((row) => within(row).getAllByRole("rowheader")[0]?.textContent);
    expect(names()).toEqual(["Маршрутизация обращений", "Разбор входящих счетов", "Проверка договоров на риски"]);

    const header = screen.getByRole("columnheader", { name: /Окупаемость/ });
    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "ascending");
    // 1,09 → 5,22 → null (нет окупаемости) в конце
    expect(names()).toEqual(["Маршрутизация обращений", "Разбор входящих счетов", "Проверка договоров на риски"]);
    await user.click(within(header).getByRole("button"));
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(names()).toEqual(["Разбор входящих счетов", "Маршрутизация обращений", "Проверка договоров на риски"]);
  });
});

describe("AssessmentPage: панель процесса", () => {
  it("клик по строке открывает панель: расчёт по шагам, три сценария, модель, флаги и оценки", async () => {
    const user = userEvent.setup();
    setup();
    await openDemo(user);
    await user.click(rowButton("Разбор входящих счетов"));

    const dialog = screen.getByRole("dialog", { name: "Разбор входящих счетов" });
    const steps = within(within(dialog).getByTestId("money-steps")).getAllByRole("listitem");
    expect(steps).toHaveLength(10);
    expect(within(dialog).getByText("Эффект за 12 мес.")).toBeInTheDocument();

    const scenarios = within(within(dialog).getByTestId("scenario-table")).getAllByRole("row");
    expect(scenarios).toHaveLength(4); // заголовок + три сценария
    for (const label of ["Пессимистичный", "Базовый", "Оптимистичный"]) {
      expect(within(dialog).getByRole("rowheader", { name: new RegExp(label) })).toBeInTheDocument();
    }

    expect(within(dialog).getByText("Сбер GigaChat — лёгкий класс")).toBeInTheDocument();
    expect(within(dialog).getByText("нужно обезличивание")).toBeInTheDocument();
    expect(within(dialog).getByText("Переменная часть")).toBeInTheDocument();
    expect(within(dialog).getAllByRole("meter").map((meter) => meter.getAttribute("aria-label"))).toEqual([
      "Пригодность для ИИ",
      "Эффект",
      "Лёгкость внедрения",
      "Приоритет",
    ]);

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("у процесса без допустимой модели нет денежного расчёта, но есть критичный флаг", async () => {
    const user = userEvent.setup();
    setup();
    await openDemo(user);
    await user.click(rowButton("Проверка договоров на риски"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Расчёт эффекта не выполнен")).toBeInTheDocument();
    expect(within(dialog).queryByTestId("money-steps")).toBeNull();
    expect(within(dialog).getByText("Критично")).toBeInTheDocument();
    expect(within(dialog).getByText("Нет модели, проходящей политику данных.")).toBeInTheDocument();
  });

  it("клик по пузырьку диаграммы и по чипу плана внедрения тоже открывает панель", async () => {
    const user = userEvent.setup();
    setup();
    await openDemo(user);
    await user.click(screen.getByRole("button", { name: /Маршрутизация обращений — Быстрая победа/ }));
    expect(screen.getByRole("dialog", { name: "Маршрутизация обращений" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    const wave = screen.getAllByTestId("roadmap-wave")[1] as HTMLElement;
    await user.click(within(wave).getByRole("button", { name: "Разбор входящих счетов" }));
    expect(screen.getByRole("dialog", { name: "Разбор входящих счетов" })).toBeInTheDocument();
  });
});

describe("AssessmentPage: пересчёт «что-если»", () => {
  async function openAssumptions(user: ReturnType<typeof userEvent.setup>) {
    await openDemo(user);
    const toggle = screen.getByRole("button", { name: /Допущения/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
  }

  it("отправляет сохранённые процессы и изменённые допущения в /api/assess и помечает результат бейджем", async () => {
    const user = userEvent.setup();
    const api = setup();
    await openAssumptions(user);

    const horizon = screen.getByLabelText(/Горизонт, мес\./);
    await user.clear(horizon);
    await user.type(horizon, "24");
    const errorField = screen.getByLabelText(/Снижение ошибок/);
    await user.clear(errorField);
    await user.type(errorField, "40");
    await user.click(screen.getByRole("checkbox", { name: /обходные пути доступа/ }));
    await user.click(screen.getByRole("button", { name: "Пересчитать" }));

    expect(await screen.findByText("что-если, не сохранено", { selector: ".banner__title .badge" })).toBeInTheDocument();
    const [call] = api.callsTo("POST", "/api/assess");
    const body = call?.body as AssessmentRequest;
    expect(body.processes).toEqual(processes);
    expect(body.name).toBe(stored.name);
    expect(body.assumptions).toMatchObject({
      horizon_months: 24,
      error_reduction: 0.4,
      allow_workarounds: true,
      usd_rub: 90,
      support_share_per_month: 0.02,
    });
    expect(kpiList().getByText("Эффект за 24 мес.")).toBeInTheDocument();
    expect(kpiList().getByText("9,9 млн ₽")).toBeInTheDocument();
  });

  it("«Сохранить как новую оценку» создаёт копию через POST /api/assessments и открывает её", async () => {
    const user = userEvent.setup();
    const api = setup();
    await openAssumptions(user);
    await user.clear(screen.getByLabelText(/Горизонт, мес\./));
    await user.type(screen.getByLabelText(/Горизонт, мес\./), "24");
    await user.click(screen.getByRole("button", { name: "Пересчитать" }));
    await user.click(await screen.findByRole("button", { name: "Сохранить как новую оценку" }));

    await waitFor(() => expect(api.callsTo("POST", "/api/assessments")).toHaveLength(1));
    const body = api.callsTo("POST", "/api/assessments")[0]?.body as AssessmentRequest;
    expect(body.name).toBe("Демо: ООО «Ромашка» (что-если)");
    expect(body.assumptions?.horizon_months).toBe(24);
    await waitFor(() => expect(api.callsTo("GET", "/api/assessments/a2")).toHaveLength(1));
  });

  it("«Сбросить» возвращает сохранённый расчёт и убирает бейдж", async () => {
    const user = userEvent.setup();
    setup();
    await openAssumptions(user);
    await user.clear(screen.getByLabelText(/Горизонт, мес\./));
    await user.type(screen.getByLabelText(/Горизонт, мес\./), "24");
    await user.click(screen.getByRole("button", { name: "Пересчитать" }));
    await screen.findByText("что-если, не сохранено", { selector: ".banner__title .badge" });

    await user.click(screen.getByRole("button", { name: "Сбросить" }));
    expect(screen.queryByText("что-если, не сохранено")).toBeNull();
    expect(kpiList().getByText("Эффект за 12 мес.")).toBeInTheDocument();
  });

  it("некорректные допущения подсвечиваются, а «Пересчитать» блокируется", async () => {
    const user = userEvent.setup();
    const api = setup();
    await openAssumptions(user);
    await user.clear(screen.getByLabelText(/Горизонт, мес\./));
    await user.type(screen.getByLabelText(/Горизонт, мес\./), "0");
    expect(screen.getByText("Не меньше 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Пересчитать" })).toBeDisabled();
    await user.clear(screen.getByLabelText(/Горизонт, мес\./));
    await user.type(screen.getByLabelText(/Горизонт, мес\./), "1,5");
    expect(screen.getByText("Нужно целое число")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/assess")).toHaveLength(0);
  });

  it("«Значения по умолчанию» подставляет числа из /api/meta", async () => {
    const user = userEvent.setup();
    setup();
    await openAssumptions(user);
    const rate = screen.getByLabelText(/Курс USD\/RUB/);
    await user.clear(rate);
    await user.type(rate, "120");
    await user.click(screen.getByRole("button", { name: "Значения по умолчанию" }));
    expect(screen.getByLabelText(/Курс USD\/RUB/)).toHaveValue("90");
  });
});
