import { screen } from "@testing-library/react";
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
});
