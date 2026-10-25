import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ModelPick } from "../../api/types";
import { MetaContext } from "../../hooks/useMeta";
import { defaultAssumptions, meta, processResult } from "../../test/fixtures";
import { primaryAdvice, primaryCatalog } from "../../test/primaryAdvice";
import { mockFetch } from "../../test/mockFetch";
import { AssumptionsPanel } from "../assessment/AssumptionsPanel";
import { ProcessDrawer } from "../assessment/ProcessDrawer";
import { AdvisorPage } from "./AdvisorPage";
import { EvalsPage } from "../evals/EvalsPage";

const demoMeta = { ...meta, demo_mode: true };

it("публичный подбор: без доступа к зарубежным API подходят российские модели, остальные — в таблице с причинами", async () => {
  const user = userEvent.setup();
  const api = mockFetch([{ method: "POST", path: "/api/advice", reply: primaryAdvice }]);
  render(
    <MetaContext.Provider value={demoMeta}>
      <AdvisorPage />
    </MetaContext.Provider>,
  );
  const cards = await screen.findAllByTestId("recommendation");
  expect(cards.map((c) => within(c).getByRole("heading", { level: 3 }).textContent)).toEqual([
    "GigaChat 2 Lite",
    "GigaChat 2 Pro",
    "Alice AI LLM",
    "GigaChat 2 Max",
    "YandexGPT Pro 5.1",
  ]);
  expect(api.callsTo("POST", "/api/advice")[0]?.body).toMatchObject({
    data_sensitivity: "internal",
    supported_region: false,
    allow_workarounds: false,
    prefer: "balanced",
    tokens_in: 700,
    tokens_out: 60,
    deepseek_period: "peak",
  });
  expect(screen.getByText(/Подходят 5 моделей, исключено: 6 · курс 80,54 ₽\/\$/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Показать все подходящие" })).not.toBeInTheDocument();

  const table = screen.getByRole("region", { name: "Стоимость и оценки моделей" });
  expect(within(table).getAllByRole("row")).toHaveLength(12);
  expect(screen.getByRole("heading", { level: 3, name: "Все модели для этой нагрузки" })).toBeInTheDocument();
  expect(table).toHaveTextContent("800 / 800 ₽ с НДС");
  expect(table).toHaveTextContent("$2 / $10 без налогов");
  expect(table).toHaveTextContent("6 080 ₽");
  expect(within(table).getAllByText("$20")).toHaveLength(2);
  expect(table).toHaveTextContent("Цена за 1 млн токенов");
  expect(within(table).getAllByText("подходит")).toHaveLength(5);
  expect(within(table).getAllByText("не подходит")).toHaveLength(6);
  expect(table).toHaveTextContent("Доступ из РФ только через обходные пути");

  await user.selectOptions(screen.getByLabelText("Время запросов к DeepSeek"), "off_peak");
  await waitFor(() =>
    expect(api.callsTo("POST", "/api/advice").at(-1)?.body).toMatchObject({ deepseek_period: "off_peak" }),
  );
});

it("доступ к зарубежным API включает все 11 моделей, а кнопка показывает остальных", async () => {
  const user = userEvent.setup();
  const everyone = {
    ...primaryAdvice,
    excluded: [],
    model_options: primaryAdvice.model_options!.map((option) => ({ ...option, eligible: true, reasons: [] })),
  };
  const api = mockFetch([{ method: "POST", path: "/api/advice", reply: everyone }]);
  render(
    <MetaContext.Provider value={demoMeta}>
      <AdvisorPage />
    </MetaContext.Provider>,
  );
  await screen.findAllByTestId("recommendation");
  expect(screen.getByText(/Подходят 11 моделей, исключено: 0/)).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: /Есть доступ к зарубежным API/ }));
  await waitFor(() =>
    expect(api.callsTo("POST", "/api/advice").at(-1)?.body).toMatchObject({ supported_region: true }),
  );
  await user.click(screen.getByRole("button", { name: "Показать все подходящие" }));
  await waitFor(() => expect(api.callsTo("POST", "/api/advice").at(-1)?.search.get("top")).toBe("20"));
});

it("карточка процесса показывает российский тариф в рублях с НДС и все 11 моделей", () => {
  const first = primaryAdvice.recommendations[0]!;
  render(
    <MetaContext.Provider value={meta}>
      <ProcessDrawer
        process={processResult({ model_options: primaryAdvice.model_options, model: { ...first } })}
        assumptions={defaultAssumptions}
        infra={[]}
        onClose={vi.fn()}
      />
    </MetaContext.Provider>,
  );
  const dialog = screen.getByRole("dialog");
  const all = within(dialog).getByRole("region", { name: "Сравнение всех моделей для этой нагрузки" });
  expect(all).toHaveTextContent("Claude Sonnet 5.5");
  expect(all).toHaveTextContent("YandexGPT Pro 5.1");
  expect(within(within(all).getByRole("region", { name: "Стоимость и оценки моделей" })).getAllByRole("row")).toHaveLength(12);
  expect(dialog).toHaveTextContent("API: 494 ₽/мес с НДС · Стандартный тариф, без кэша.");
  expect(dialog).not.toHaveTextContent("Пересчёт в рубли");
  expect(dialog).toHaveTextContent("Качество для задачи, экспертно");
});

it("карточка процесса показывает зарубежный тариф в долларах без налогов и пересчёт по курсу", () => {
  const option = primaryAdvice.model_options!.find((o) => o.model_id === "claude-sonnet-5-5")!;
  const model: ModelPick = {
    model_id: option.model_id,
    name: option.name,
    quality: option.quality,
    score: 64.7,
    deployment: "foreign_cloud",
    requires_masking: false,
    cost: option.cost!,
  };
  render(
    <MetaContext.Provider value={meta}>
      <ProcessDrawer
        process={processResult({ model_options: primaryAdvice.model_options, model })}
        assumptions={defaultAssumptions}
        infra={[]}
        onClose={vi.fn()}
      />
    </MetaContext.Provider>,
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "API: $20/мес без налогов · Стандартный тариф, без кэша. Пересчёт в рубли — по курсу из допущений.",
  );
});

it("общие допущения сохраняют приоритет, период и доступ к зарубежным API при пересчёте", async () => {
  const user = userEvent.setup();
  const recalculate = vi.fn();
  render(
    <AssumptionsPanel
      baseline={defaultAssumptions}
      defaults={defaultAssumptions}
      whatIfActive={false}
      busy={false}
      error={undefined}
      onRecalculate={recalculate}
      onReset={vi.fn()}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Допущения/ }));
  await user.selectOptions(screen.getByLabelText("Приоритет подбора"), "cost");
  await user.selectOptions(screen.getByLabelText("Время запросов к DeepSeek"), "off_peak");
  await user.click(screen.getByRole("checkbox", { name: /Есть доступ к зарубежным API/ }));
  await user.click(screen.getByRole("button", { name: "Пересчитать" }));
  expect(recalculate).toHaveBeenCalledWith(
    expect.objectContaining({
      model_preference: "cost",
      deepseek_period: "off_peak",
      supported_region: true,
      usd_rub: 80.54,
    }),
  );
});

it("качество в публичном демо открывает матрицу из 11 моделей и не вызывает измерения", async () => {
  const api = mockFetch([{ path: "/api/catalog", reply: primaryCatalog }]);
  render(
    <MetaContext.Provider value={demoMeta}>
      <EvalsPage />
    </MetaContext.Provider>,
  );
  const table = await screen.findByRole("region", { name: "Оценки качества по типам задач" });
  expect(within(table).getAllByRole("columnheader")).toHaveLength(meta.task_types.length + 1);
  // заголовок + 2 группы + 11 моделей
  expect(within(table).getAllByRole("row")).toHaveLength(1 + 2 + 11);
  expect(screen.queryByRole("button", { name: "Реальные измерения" })).not.toBeInTheDocument();
  expect(api.callsTo("GET", "/api/evals/measured")).toHaveLength(0);
  expect(api.callsTo("GET", "/api/evals/demo")).toHaveLength(0);
});
