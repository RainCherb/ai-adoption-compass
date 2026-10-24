import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfusionMatrix } from "./ConfusionMatrix";

const labels = ["billing", "delivery"];
const titles = { billing: "Оплата и счета", delivery: "Доставка" };

describe("ConfusionMatrix", () => {
  it("показывает количество в каждой ячейке и названия классов на осях", () => {
    render(<ConfusionMatrix labels={labels} matrix={[[3, 1], [2, 2]]} titles={titles} />);
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    // две строки заголовка + по строке на класс
    expect(rows).toHaveLength(4);
    const rowOf = (title: string) => screen.getByRole("rowheader", { name: title }).closest("tr") as HTMLElement;
    expect(within(rowOf("Оплата и счета")).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["3", "1"]);
    expect(within(rowOf("Доставка")).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2", "2"]);
    expect(screen.getByRole("columnheader", { name: "Оплата и счета" })).toBeInTheDocument();
    expect(screen.getByText(/Ответ модели/)).toBeInTheDocument();
  });

  it("отличает верные ответы (диагональ) от ошибок и подписывает ячейки", () => {
    render(<ConfusionMatrix labels={labels} matrix={[[3, 1], [2, 2]]} titles={titles} />);
    const hit = screen.getAllByRole("cell").filter((cell) => cell.classList.contains("confusion__cell--hit"));
    const miss = screen.getAllByRole("cell").filter((cell) => cell.classList.contains("confusion__cell--miss"));
    expect(hit.map((cell) => cell.textContent)).toEqual(["3", "2"]);
    expect(miss.map((cell) => cell.textContent)).toEqual(["1", "2"]);
    expect(miss[0]).toHaveAttribute("title", "Ожидалось «Оплата и счета», ответ «Доставка»: 1");
  });

  it("без словаря названий показывает исходные имена классов", () => {
    render(<ConfusionMatrix labels={labels} matrix={[[1, 0], [0, 1]]} />);
    expect(screen.getByRole("rowheader", { name: "billing" })).toBeInTheDocument();
  });
});
