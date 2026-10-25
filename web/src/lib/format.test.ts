import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatDollars,
  formatFte,
  formatHours,
  formatMonths,
  formatNumber,
  formatPercent,
  formatPercentValue,
  formatRub,
  formatRubCompact,
  formatRubPrecise,
  pluralRu,
} from "./format";

const NBSP = "\u00A0";

describe("formatRub", () => {
  it("разделяет разряды неразрывными пробелами и ставит ₽", () => {
    expect(formatRub(1234567)).toBe(`1${NBSP}234${NBSP}567${NBSP}₽`);
    expect(formatRub(0)).toBe(`0${NBSP}₽`);
  });

  it("округляет до рублей и использует настоящий минус", () => {
    expect(formatRub(-82053.09)).toBe(`\u2212${"82"}${NBSP}053${NBSP}₽`);
    expect(formatRub(-0.2)).toBe(`0${NBSP}₽`);
  });

  it("для отсутствующих значений возвращает тире", () => {
    expect(formatRub(null)).toBe("—");
    expect(formatRub(undefined)).toBe("—");
    expect(formatRub(Number.NaN)).toBe("—");
  });
});

describe("краткие и точные суммы", () => {
  it("formatRubCompact переводит большие суммы в тыс./млн/млрд", () => {
    expect(formatRubCompact(5_810_345.84)).toBe(`5,8${NBSP}млн${NBSP}₽`);
    expect(formatRubCompact(850_000)).toBe(`850${NBSP}тыс.${NBSP}₽`);
    expect(formatRubCompact(2_400_000_000)).toBe(`2,4${NBSP}млрд${NBSP}₽`);
    expect(formatRubCompact(12_345)).toBe(`12${NBSP}345${NBSP}₽`);
  });

  it("formatRubPrecise показывает копейки у малых сумм", () => {
    expect(formatRubPrecise(0.01367)).toBe(`0,014${NBSP}₽`);
    expect(formatRubPrecise(11.0158)).toBe(`11,02${NBSP}₽`);
    expect(formatRubPrecise(1500)).toBe(`1${NBSP}500${NBSP}₽`);
    expect(formatRubPrecise(0)).toBe(`0${NBSP}₽`);
  });

  it("formatRubPrecise не округляет ненулевую сумму до нуля", () => {
    expect(formatRubPrecise(0.000162)).toBe(`0,000162${NBSP}₽`);
    expect(formatRubPrecise(0.0004)).toBe(`0,0004${NBSP}₽`);
  });

  it("formatDollars: два знака от доллара, больше — у малых сумм, знак доллара впереди", () => {
    expect(formatDollars(50)).toBe("$50");
    expect(formatDollars(6.6)).toBe("$6,6");
    expect(formatDollars(1234.567)).toBe(`$1${NBSP}234,57`);
    expect(formatDollars(0.5)).toBe("$0,5");
    expect(formatDollars(0.044)).toBe("$0,044");
    expect(formatDollars(0.000002)).toBe("$0,000002");
    expect(formatDollars(0)).toBe("$0");
    expect(formatDollars(null)).toBe("—");
  });
});

describe("единицы измерения", () => {
  it("месяцы, часы и FTE", () => {
    expect(formatMonths(3.31)).toBe(`3,3${NBSP}мес.`);
    expect(formatMonths(null)).toBe("—");
    expect(formatHours(250.84)).toBe(`250,8${NBSP}ч`);
    expect(formatFte(5.94)).toBe(`5,9${NBSP}FTE`);
  });

  it("проценты: доли и готовые проценты", () => {
    expect(formatPercent(0.25)).toBe(`25${NBSP}%`);
    expect(formatPercent(0.8472, 1)).toBe(`84,7${NBSP}%`);
    expect(formatPercentValue(155.4)).toBe(`155${NBSP}%`);
  });

  it("размер переключается на КБ/МБ", () => {
    expect(formatBytes(2_000_000)).toBe(`2${NBSP}МБ`);
    expect(formatBytes(1500)).toBe(`2${NBSP}КБ`);
  });
});

describe("русские числительные", () => {
  it.each([
    [1, "процесс"],
    [2, "процесса"],
    [5, "процессов"],
    [11, "процессов"],
    [21, "процесс"],
    [24, "процесса"],
    [112, "процессов"],
  ])("pluralRu(%i) → %s", (count, expected) => {
    expect(pluralRu(count, "процесс", "процесса", "процессов")).toBe(expected);
  });

  it("formatCount склеивает число и слово неразрывным пробелом", () => {
    expect(formatCount(18, "процесс", "процесса", "процессов")).toBe(`18${NBSP}процессов`);
  });
});

describe("даты", () => {
  it("formatDate не сдвигает дату без времени часовым поясом", () => {
    expect(formatDate("2026-10-24")).toBe("24.10.2026");
    expect(formatDate(null)).toBe("—");
    expect(formatDate("не дата")).toBe("не дата");
  });

  it("formatDateTime выводит дату и время в формате ru-RU", () => {
    // Тесты идут в TZ=UTC (см. vite.config.ts).
    expect(formatDateTime("2026-10-24T03:11:06+00:00")).toBe("24.10.2026, 03:11");
  });
});

describe("formatNumber", () => {
  it("поддерживает минимальное число знаков после запятой", () => {
    expect(formatNumber(2.5, 2, 2)).toBe("2,50");
    expect(formatNumber(1000.4, 0)).toBe(`1${NBSP}000`);
  });
});
