import { describe, expect, it } from "vitest";
import { DEFAULT_ROUTE, ROUTES, hrefFor, parseRoute } from "./routes";

describe("маршрутизация по хешу", () => {
  it("пустой и неизвестный хеш ведёт на страницу по умолчанию", () => {
    expect(parseRoute("")).toBe(DEFAULT_ROUTE);
    expect(parseRoute("#")).toBe("models");
    expect(parseRoute("#/нет-такой")).toBe("models");
  });

  it("понимает все семь маршрутов, с косой чертой и без, и игнорирует хвост", () => {
    expect(ROUTES.map((route) => route.id)).toEqual(["models", "assessment", "advisor", "safety", "prompts", "evals", "audit"]);
    for (const route of ROUTES) {
      expect(parseRoute(hrefFor(route.id))).toBe(route.id);
      expect(parseRoute(`#${route.id}`)).toBe(route.id);
    }
    expect(parseRoute("#/advisor?tab=catalog")).toBe("advisor");
    expect(parseRoute("#/prompts/customer-reply")).toBe("prompts");
  });
});
