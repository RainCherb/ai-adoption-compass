import { describe, expect, it } from "vitest";
import type { CostBreakdown } from "../api/types";
import { describeTariff, formatRatePair, priceBasis, taxNote } from "./pricing";

const NBSP = "\u00A0";

const rubCost: CostBreakdown = {
  variable_rub: 6080,
  fixed_rub: 0,
  total_rub: 6080,
  units: 1,
  currency: "RUB",
  vat_included: true,
  input_rate: 800,
  output_rate: 800,
};

const usdCost: CostBreakdown = {
  variable_rub: 1610.8,
  fixed_rub: 0,
  total_rub: 1610.8,
  units: 1,
  currency: "USD",
  vat_included: false,
  input_rate: 2,
  output_rate: 10,
  input_rate_usd: 2,
  output_rate_usd: 10,
};

describe("priceBasis", () => {
  it("берёт валюту и налоги из расчёта", () => {
    expect(priceBasis(rubCost)).toEqual({ currency: "RUB", vatIncluded: true });
    expect(priceBasis(usdCost)).toEqual({ currency: "USD", vatIncluded: false });
  });

  it("если в расчёте валюты нет, использует профиль модели", () => {
    const bare: CostBreakdown = { variable_rub: 1, fixed_rub: 0, total_rub: 1, units: 1 };
    expect(priceBasis(bare, { currency: "RUB", vat_included: true })).toEqual({ currency: "RUB", vatIncluded: true });
    expect(priceBasis(null, { currency: "USD", vat_included: false })).toEqual({ currency: "USD", vatIncluded: false });
  });

  it("у модели без прямого тарифа основы нет", () => {
    expect(priceBasis({ variable_rub: 1, fixed_rub: 0, total_rub: 1, units: 1 })).toBeNull();
    expect(priceBasis(null)).toBeNull();
  });
});

describe("taxNote", () => {
  it.each([
    [{ currency: "RUB", vatIncluded: true }, "с НДС"],
    [{ currency: "RUB", vatIncluded: false }, "без НДС"],
    [{ currency: "USD", vatIncluded: false }, "без налогов"],
    [{ currency: "USD", vatIncluded: true }, "с НДС"],
  ] as const)("%o → %s", (basis, expected) => {
    expect(taxNote(basis)).toBe(expected);
  });
});

describe("тарифы за 1 млн токенов", () => {
  it("рубли: «800 / 800 ₽», доллары: «$2 / $10»", () => {
    expect(formatRatePair(800, 800, "RUB")).toBe(`800 / 800${NBSP}₽`);
    expect(formatRatePair(500, 1200, "RUB")).toBe(`500 / 1${NBSP}200${NBSP}₽`);
    expect(formatRatePair(2, 10, "USD")).toBe("$2 / $10");
    expect(formatRatePair(0.1, 0.5, "USD")).toBe("$0,1 / $0,5");
    expect(formatRatePair(1.32, 3.96, "USD")).toBe("$1,32 / $3,96");
    expect(formatRatePair(null, 1, "USD")).toBe("—");
  });

  it("describeTariff добавляет налоговую основу", () => {
    expect(describeTariff(rubCost)).toBe(`800 / 800${NBSP}₽ с НДС`);
    expect(describeTariff(usdCost)).toBe("$2 / $10 без налогов");
  });

  it("без тарифа в расчёте описания нет", () => {
    expect(describeTariff(null)).toBeNull();
    expect(describeTariff({ ...usdCost, input_rate: null })).toBeNull();
  });
});
