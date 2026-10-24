import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { auditEvents } from "../../test/fixtures";
import { mockFetch, reply } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { AuditPage } from "./AuditPage";

describe("AuditPage", () => {
  it("показывает события: время по-русски, тип бейджем, payload ключ-значение чипами", async () => {
    const api = mockFetch([{ path: "/api/audit", reply: { events: auditEvents } }]);
    renderWithMeta(<AuditPage />);
    const rows = await screen.findAllByTestId("audit-row");
    expect(rows).toHaveLength(3);
    expect(api.callsTo("GET", "/api/audit")[0]?.search.get("limit")).toBe("100");

    const lint = within(rows[0] as HTMLElement);
    expect(lint.getByText("24.10.2026, 03:14")).toBeInTheDocument();
    expect(lint.getByText("Проверка промпта")).toBeInTheDocument();
    expect(lint.getByText("символов:").nextElementSibling).toHaveTextContent("58");
    expect(lint.getByText("ПДн:").nextElementSibling).toHaveTextContent("PHONE_RU=1");

    const safety = within(rows[1] as HTMLElement);
    expect(safety.getByText("секреты:").nextElementSibling).toHaveTextContent("да");
    expect(safety.getByText("решения:").nextElementSibling).toHaveTextContent("ru_cloud=deny");
  });

  it("напоминает, что в журнале только метаданные", async () => {
    mockFetch([{ path: "/api/audit", reply: { events: [] } }]);
    renderWithMeta(<AuditPage />);
    expect(screen.getByText("Здесь только метаданные")).toBeInTheDocument();
    expect(await screen.findByText("Событий пока нет")).toBeInTheDocument();
  });

  it("фильтр по типу события передаёт kind в запрос, «Обновить» повторяет его", async () => {
    const user = userEvent.setup();
    const api = mockFetch([{ path: "/api/audit", handle: (request) => ({ events: request.search.get("kind") ? [auditEvents[1]] : auditEvents }) }]);
    renderWithMeta(<AuditPage />);
    await screen.findAllByTestId("audit-row");

    await user.selectOptions(screen.getByLabelText("Тип события"), "safety.analyze");
    await waitFor(() => expect(screen.getAllByTestId("audit-row")).toHaveLength(1));
    expect(api.callsTo("GET", "/api/audit").at(-1)?.search.get("kind")).toBe("safety.analyze");

    const before = api.callsTo("GET", "/api/audit").length;
    await user.click(screen.getByRole("button", { name: "Обновить" }));
    await waitFor(() => expect(api.callsTo("GET", "/api/audit").length).toBe(before + 1));
  });

  it("ошибка загрузки — баннер с повтором", async () => {
    const user = userEvent.setup();
    let fail = true;
    mockFetch([{ path: "/api/audit", handle: () => (fail ? reply(500, { detail: "Хранилище недоступно" }) : { events: auditEvents }) }]);
    renderWithMeta(<AuditPage />);
    expect(await screen.findByText("Хранилище недоступно")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findAllByTestId("audit-row")).toHaveLength(3);
  });
});
