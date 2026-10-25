import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/errors";
import type { Health } from "../../api/types";
import type { AsyncState } from "../../hooks/useAsync";
import { health } from "../../test/fixtures";
import { StatusChip } from "./StatusChip";

function state(catalog: Partial<Health["catalog"]>): AsyncState<Health> {
  return {
    data: { ...health, catalog: { ...health.catalog, ...catalog } },
    error: undefined,
    loading: false,
    reload: vi.fn(),
  };
}

describe("StatusChip", () => {
  it("для справочных данных сообщает дату сверки тарифов и экспертное качество", () => {
    render(<StatusChip health={state({ data_status: "illustrative", as_of: "2026-10-25" })} />);
    const chip = screen.getByTestId("catalog-status");
    expect(chip).toHaveTextContent("Тарифы сверены 25.10.2026 · качество — экспертно");
    expect(chip).toHaveClass("status-chip--warning");
    expect(chip).not.toHaveTextContent("демо-данные");
  });

  it("для проверенных данных без устаревших записей показывает зелёный статус каталога", () => {
    render(<StatusChip health={state({ data_status: "verified", as_of: "2026-10-25", stale: 0 })} />);
    const chip = screen.getByTestId("catalog-status");
    expect(chip).toHaveTextContent("Каталог: проверенные данные · 25.10.2026");
    expect(chip).toHaveClass("status-chip--success");
  });

  it("число устаревших записей видно в любом статусе", () => {
    render(<StatusChip health={state({ data_status: "illustrative", stale: 2 })} />);
    expect(screen.getByTestId("catalog-status")).toHaveTextContent("· качество — экспертно · устарело: 2");
  });

  it("при недоступном API сообщает об этом", () => {
    render(
      <StatusChip
        health={{ data: undefined, error: new ApiError("Хранилище недоступно", 503), loading: false, reload: vi.fn() }}
      />,
    );
    expect(screen.getByText("API недоступен")).toBeInTheDocument();
  });
});
