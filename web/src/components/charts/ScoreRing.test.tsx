import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreRing, toneForScore } from "./ScoreRing";

describe("ScoreRing", () => {
  it("описывает значение для скринридера и показывает округлённое число", () => {
    render(<ScoreRing value={73.6} label="Итоговая оценка" />);
    expect(screen.getByRole("img", { name: "Итоговая оценка: 74 из 100" })).toBeInTheDocument();
    expect(screen.getByText("74")).toBeInTheDocument();
  });

  it("ограничивает значение диапазоном шкалы", () => {
    const { rerender } = render(<ScoreRing value={250} label="Оценка" />);
    expect(screen.getByRole("img", { name: "Оценка: 100 из 100" })).toBeInTheDocument();
    rerender(<ScoreRing value={-5} label="Оценка" />);
    expect(screen.getByRole("img", { name: "Оценка: 0 из 100" })).toBeInTheDocument();
  });

  it("цвет выбирается по порогам 70 и 50, но его можно задать явно", () => {
    expect(toneForScore(85)).toBe("success");
    expect(toneForScore(55)).toBe("warning");
    expect(toneForScore(20)).toBe("danger");
    const { container, rerender } = render(<ScoreRing value={20} label="Оценка" />);
    expect(container.querySelector(".score-ring--danger")).not.toBeNull();
    rerender(<ScoreRing value={20} label="Оценка" tone="info" />);
    expect(container.querySelector(".score-ring--info")).not.toBeNull();
  });

  it("длина дуги пропорциональна значению", () => {
    const { container } = render(<ScoreRing value={50} label="Оценка" size={100} />);
    const arc = container.querySelector(".score-ring__value");
    const [dash = 0, total = 1] = (arc?.getAttribute("stroke-dasharray") ?? "").split(" ").map(Number);
    expect(dash / total).toBeCloseTo(0.5, 5);
  });
});
