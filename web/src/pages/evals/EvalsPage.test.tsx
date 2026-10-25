import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MetaContext } from "../../hooks/useMeta";
import { meta } from "../../test/fixtures";
import { primaryCatalog } from "../../test/primaryAdvice";
import { mockFetch } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { CLI_SNIPPET, EvalsPage } from "./EvalsPage";

const TASK_LABELS: Record<string, string> = {
  classification: "Классификация и маршрутизация",
  extraction: "Извлечение данных из документов",
  summarization: "Резюмирование",
  drafting: "Подготовка текстов и ответов",
  qa_search: "Ответы по базе знаний",
  translation: "Перевод и локализация",
  analysis: "Анализ данных и отчёты",
  code: "Скрипты, SQL, формулы",
  decision_support: "Поддержка решений",
};

function setup() {
  const api = mockFetch([{ path: "/api/catalog", reply: primaryCatalog }]);
  renderWithMeta(<EvalsPage />);
  return api;
}

async function matrix() {
  return within(await screen.findByRole("region", { name: "Оценки качества по типам задач" }));
}

describe("Качество API-моделей", () => {
  it("показывает единую экспертную матрицу 11 моделей и не загружает локальные измерения", async () => {
    const api = setup();
    const table = await matrix();
    expect(
      screen.getByText("Экспертная матрица качества 11 моделей — российских и зарубежных — для подбора и ROI."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/трёх/)).not.toBeInTheDocument();
    for (const name of ["YandexGPT Pro 5.1", "Alice AI LLM", "GigaChat 2 Max", "Claude Sonnet 5.5", "GPT-6.1 Sol", "DeepSeek V4 Pro"]) {
      expect(table.getByRole("rowheader", { name: new RegExp(name.replace(".", "\\.")) })).toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "Реальные измерения" })).not.toBeInTheDocument();
    expect(api.callsTo("GET", "/api/evals/measured")).toHaveLength(0);
    expect(api.callsTo("GET", "/api/evals/demo")).toHaveLength(0);
  });

  it("строки — модели в двух группах, столбцы — типы задач, в ячейках только оценка", async () => {
    setup();
    const table = await matrix();
    const rows = table.getAllByRole("row");
    expect(rows.map((row) => row.querySelector("th")?.firstChild?.textContent)).toEqual([
      "Модель",
      "Российские облака",
      "YandexGPT Pro 5.1",
      "Alice AI LLM",
      "GigaChat 2 Max",
      "GigaChat 2 Pro",
      "GigaChat 2 Lite",
      "Зарубежные API",
      "Claude Sonnet 5.5",
      "Claude Haiku 5.5",
      "GPT-6.1 Sol",
      "GPT-6 Luna",
      "DeepSeek V4.1 Flash",
      "DeepSeek V4 Pro",
    ]);

    const yandex = within(rows[2]!);
    expect(yandex.getByRole("rowheader")).toHaveTextContent("YandexGPT Pro 5.1Яндекс");
    const cells = yandex.getAllByRole("cell");
    // в тестовой /api/meta три типа задач: классификация, тексты, анализ
    expect(cells.map((cell) => cell.textContent)).toEqual(["4", "5", "3"]);
    expect(cells.map((cell) => cell.querySelector(".quality-cell")?.getAttribute("data-quality"))).toEqual(["4", "5", "3"]);

    const sonnet = within(rows[8]!).getAllByRole("cell");
    expect(sonnet.map((cell) => cell.textContent)).toEqual(["5", "5", "4"]);
  });

  it("столбцы имеют короткие заголовки, а полное название типа задачи — в подсказке", async () => {
    const nine = meta.task_types[0]!;
    const allTasks = Object.entries(TASK_LABELS).map(([value, label]) => ({ ...nine, value, label }));
    mockFetch([{ path: "/api/catalog", reply: primaryCatalog }]);
    render(
      <MetaContext.Provider value={{ ...meta, task_types: allTasks }}>
        <EvalsPage />
      </MetaContext.Provider>,
    );
    const table = await matrix();
    const headers = table.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Модель",
      "Классиф.",
      "Извлечение",
      "Резюме",
      "Тексты",
      "База знаний",
      "Перевод",
      "Анализ",
      "Код",
      "Решения",
    ]);
    for (const label of Object.values(TASK_LABELS)) {
      expect(table.getByTitle(label)).toBeInTheDocument();
    }
    // 9 типов задач = 9 оценок в каждой строке модели
    const firstModel = table.getAllByRole("row")[2]!;
    expect(within(firstModel).getAllByRole("cell")).toHaveLength(9);
  });

  it("показывает план проверки API и копируемую команду только по раскрытию", async () => {
    const user = userEvent.setup();
    setup();
    await matrix();
    const guide = screen.getByRole("region", { name: "План проверки API" });
    expect(guide).toHaveTextContent("p50/p95");
    await user.click(
      screen.getByRole("button", {
        name: "Команда для OpenAI-совместимого API",
      }),
    );
    expect(screen.getByTestId("cli-snippet")).toHaveTextContent("compass eval run");
    await user.click(within(guide).getByRole("button", { name: "Копировать" }));
    await expect(navigator.clipboard.readText()).resolves.toBe(CLI_SNIPPET);
  });
});
