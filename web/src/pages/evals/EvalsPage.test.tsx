import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { catalog, evalDemo } from "../../test/fixtures";
import { primaryAdvice } from "../../test/primaryAdvice";
import { mockFetch } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { pickHighlights } from "./ComparisonTable";
import { CLI_SNIPPET, EvalsPage } from "./EvalsPage";

function setup() {
  const api = mockFetch([
    {
      path: "/api/catalog",
      reply: {
        ...catalog,
        models: primaryAdvice.model_options!.map((o) => ({
          ...catalog.models[0]!,
          id: o.model_id,
          name: o.name,
          profile: o.profile,
          quality: { ...catalog.models[0]!.quality, classification: o.quality },
        })),
      },
    },
  ]);
  renderWithMeta(<EvalsPage />);
  return api;
}

describe("pickHighlights", () => {
  it("самая дешёвая — среди моделей: бесплатный baseline не в счёт, как и прогон без стоимости", () => {
    const [baseline, economy, flagship] = evalDemo.reports;
    const unknown = { ...economy!, provider: "api:x", cost_rub: null };
    expect(pickHighlights([baseline!, economy!, flagship!])).toEqual({
      best: "sim:flagship",
      cheapest: "sim:economy",
    });
    expect(pickHighlights([baseline!, unknown, flagship!])).toEqual({
      best: "sim:flagship",
      cheapest: "sim:flagship",
    });
    expect(pickHighlights([])).toEqual({ best: null, cheapest: null });
  });
});

describe("Качество API-моделей", () => {
  it("показывает единую экспертную матрицу и не загружает локальные измерения", async () => {
    const api = setup();
    const matrix = await screen.findByRole("region", {
      name: "Оценки качества по типам задач",
    });
    expect(matrix).toHaveTextContent("Claude Sonnet 5.5");
    expect(matrix).toHaveTextContent("GPT-6.1 Sol");
    expect(matrix).toHaveTextContent("DeepSeek V4.1 Flash");
    expect(
      screen.queryByRole("button", { name: "Реальные измерения" }),
    ).not.toBeInTheDocument();
    expect(api.callsTo("GET", "/api/evals/measured")).toHaveLength(0);
    expect(api.callsTo("GET", "/api/evals/demo")).toHaveLength(0);
  });
  it("показывает план проверки API и копируемую команду только по раскрытию", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("region", {
      name: "Оценки качества по типам задач",
    });
    const guide = screen.getByRole("region", { name: "План проверки API" });
    expect(guide).toHaveTextContent("p50/p95");
    await user.click(
      screen.getByRole("button", {
        name: "Команда для OpenAI-совместимого API",
      }),
    );
    expect(screen.getByTestId("cli-snippet")).toHaveTextContent(
      "compass eval run",
    );
    await user.click(within(guide).getByRole("button", { name: "Копировать" }));
    await expect(navigator.clipboard.readText()).resolves.toBe(CLI_SNIPPET);
  });
});
