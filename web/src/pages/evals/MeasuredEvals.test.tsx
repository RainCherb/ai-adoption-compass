import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { evalDemo } from "../../test/fixtures";
import { mockFetch } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { EvalsPage } from "./EvalsPage";

describe("Реальные измерения", () => {
  it("открывает реальные результаты и отдельно переключает симуляцию", async () => {
    const user = userEvent.setup();
    const measured = { ...evalDemo, kind: "measured", reports: evalDemo.reports.map((r) => ({ ...r, provider: r.is_baseline ? r.provider : `local:${r.provider}`, cost_rub: r.is_baseline ? 0 : null })), provenance: { created_at: "2026-10-24", dataset_sha256: "abc", limitations: ["Один синтетический набор"] } };
    mockFetch([{ path: "/api/evals/measured", reply: measured }, { path: "/api/evals/demo", reply: evalDemo }]);
    renderWithMeta(<EvalsPage />);
    expect(await screen.findByText("Измерено на настоящих локальных LLM — без платных API")).toBeInTheDocument();
    expect(screen.getAllByText("локальная LLM")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Полный артефакт/ })).toHaveAttribute("href", expect.stringContaining("measured.json"));
    await user.click(screen.getByRole("button", { name: "Симуляция для обучения" }));
    expect(await screen.findByText("Это демонстрационный прогон, а не замер реальных моделей")).toBeInTheDocument();
  });
});
