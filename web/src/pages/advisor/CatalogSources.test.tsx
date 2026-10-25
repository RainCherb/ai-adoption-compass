import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { mockFetch } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { CatalogSources } from "./CatalogSources";

describe("Источники каталога", () => {
  it("не показывает устаревший тариф как актуальный", async () => {
    mockFetch([{ path: "/api/catalog/sources", reply: { disclaimer: "Отдельно от экспертных оценок", sources: [{ id: "source", title: "Источник", url: "https://openrouter.ai/api/v1/models", stale: true, age_days: 91, snapshot: { fetched_at: "2026-01-01", status: "machine_checked", content_sha256: "abc", review_note: "Не прямой тариф", offers: [{ model_id: "old-model", input_per_mtok: 1, output_per_mtok: 2 }] } }] } }]);
    renderWithMeta(<CatalogSources />);
    expect(await screen.findByText(/Снимок отсутствует или устарел/)).toBeInTheDocument();
    expect(screen.queryByText("old-model")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Источник" })).toHaveAttribute("href", "https://openrouter.ai/api/v1/models");
  });

  it("тарифы источника показаны в его валюте: рубли и доллары", async () => {
    mockFetch([
      {
        path: "/api/catalog/sources",
        reply: {
          disclaimer: "Отдельно от экспертных оценок",
          sources: [
            {
              id: "mixed",
              title: "Сводный источник",
              url: "https://example.com/prices",
              stale: false,
              age_days: 1,
              snapshot: {
                fetched_at: "2026-10-25",
                status: "reviewed",
                content_sha256: "abc",
                review_note: "Сверено вручную",
                offers: [
                  { model_id: "ru/model", name: "Российская модель", input_per_mtok: 800, output_per_mtok: 1200, currency: "RUB" },
                  { model_id: "us/model", name: "Зарубежная модель", input_per_mtok: 2, output_per_mtok: 10, currency: "USD" },
                ],
              },
            },
          ],
        },
      },
    ]);
    renderWithMeta(<CatalogSources />);
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("row", { name: /ru\/model/ })).toHaveTextContent("800 ₽1 200 ₽");
    expect(within(table).getByRole("row", { name: /us\/model/ })).toHaveTextContent("2,00 $10,00 $");
    expect(within(table).getByRole("caption")).not.toHaveTextContent("OpenRouter");
  });
});
