import { describe, expect, it } from "vitest";
import { splitByFindings } from "./findings";

const span = (start: number, end: number) => ({ start, end });

describe("splitByFindings", () => {
  it("считает смещения кодовыми точками: эмодзи занимает одну позицию", () => {
    const text = "Привет 😀! Тел +7 999";
    // «😀» — одна кодовая точка (две единицы UTF-16), поэтому «+7 999» начинается с индекса 14.
    const start = Array.from("Привет 😀! Тел ").length;
    expect(start).toBe(14);
    const segments = splitByFindings(text, [span(start, start + 6)]);
    expect(segments.map((s) => s.text)).toEqual(["Привет 😀! Тел ", "+7 999"]);
    expect(segments[1]?.finding).toEqual(span(14, 20));
  });

  it("не режет суррогатную пару внутри находки с эмодзи", () => {
    const segments = splitByFindings("a😀b", [span(1, 2)]);
    expect(segments.map((s) => s.text)).toEqual(["a", "😀", "b"]);
  });

  it("соседние находки не оставляют пустых сегментов между собой", () => {
    const segments = splitByFindings("12345678", [span(0, 4), span(4, 8)]);
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => s.text)).toEqual(["1234", "5678"]);
    expect(segments.every((s) => s.finding)).toBe(true);
  });

  it("сортирует находки и усекает пересечения", () => {
    const segments = splitByFindings("abcdefgh", [span(4, 8), span(0, 5)]);
    expect(segments.map((s) => s.text)).toEqual(["abcde", "fgh"]);
  });

  it("отбрасывает пустые и выходящие за текст находки, остаток оставляет обычным текстом", () => {
    const segments = splitByFindings("abc", [span(2, 2), span(10, 12)]);
    expect(segments).toEqual([{ text: "abc" }]);
    expect(splitByFindings("", [span(0, 3)])).toEqual([]);
  });
});
