import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetaContext } from "../../hooks/useMeta";
import { meta, savedSummary, stored } from "../../test/fixtures";
import { mockFetch } from "../../test/mockFetch";
import { AssessmentPage } from "./AssessmentPage";

describe("Публичное демо", () => {
  it("открывает готовую оценку и блокирует действия общего хранилища", async () => {
    mockFetch([{ path: "/api/assessments", reply: [savedSummary] }, { path: `/api/assessments/${savedSummary.id}`, reply: stored }]);
    render(<MetaContext.Provider value={{ ...meta, demo_mode: true }}><AssessmentPage /></MetaContext.Provider>);
    expect(await screen.findByRole("heading", { name: stored.name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Загрузить CSV" })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Сохранённые оценки" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Удалить" })).not.toBeInTheDocument();
  });
});
