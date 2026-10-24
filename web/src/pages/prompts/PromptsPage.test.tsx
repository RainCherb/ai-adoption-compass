import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { lint, promptList, rendered } from "../../test/fixtures";
import { mockFetch, reply } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { PromptsPage } from "./PromptsPage";

function setup(overrides: { render?: unknown; lint?: unknown } = {}) {
  const api = mockFetch([
    { path: "/api/prompts", reply: promptList },
    { method: "POST", path: "/api/prompts/customer-reply/render", reply: overrides.render ?? rendered },
    { method: "POST", path: "/api/prompts/lint", reply: overrides.lint ?? lint },
    { method: "POST", path: "/api/prompts/scaffold", reply: { text: "Ты — Юрист. Твоя задача — проверить договор." } },
  ]);
  renderWithMeta(<PromptsPage />);
  return api;
}

describe("PromptsPage: шаблоны", () => {
  it("группирует шаблоны по отделам и по умолчанию открывает первый из списка", async () => {
    setup();
    const list = await screen.findByRole("navigation", { name: "Шаблоны промптов" });
    expect(within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Поддержка", "Юристы"]);
    expect(within(list).getByRole("button", { name: /Ответ клиенту на обращение/ })).toHaveAttribute("aria-current", "true");
    expect(await screen.findByRole("heading", { name: "Ответ клиенту на обращение", level: 2 })).toBeInTheDocument();
  });

  it("форма строится по типам переменных: textarea, select и input; значения по умолчанию подставлены", async () => {
    setup();
    await screen.findByRole("heading", { name: "Ответ клиенту на обращение", level: 2 });
    expect(screen.getByLabelText(/Сообщение клиента/).tagName).toBe("TEXTAREA");
    const tone = screen.getByLabelText(/Тон ответа/);
    expect(tone.tagName).toBe("SELECT");
    expect(tone).toHaveValue("вежливый");
    expect(within(tone).getAllByRole("option").map((o) => o.textContent)).toEqual(["вежливый", "деловой"]);
    expect(screen.getByLabelText(/Подпись/).tagName).toBe("INPUT");
  });

  it("пока обязательное поле пусто, промпт не собирается; после ввода уходит запрос render с значениями", async () => {
    const api = setup();
    await screen.findByRole("heading", { name: "Ответ клиенту на обращение", level: 2 });
    expect(screen.getByText("Заполните обязательные поля")).toBeInTheDocument();
    expect(api.callsTo("POST", "/api/prompts/customer-reply/render")).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Сообщение клиента/), { target: { value: "Заказ не пришёл" } });
    const output = await screen.findByTestId("rendered-prompt", undefined, { timeout: 2000 });
    expect(output).toHaveTextContent("Ты — менеджер поддержки");
    const calls = api.callsTo("POST", "/api/prompts/customer-reply/render");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({ values: { message: "Заказ не пришёл", tone: "вежливый", signature: "" } });

    expect(screen.getByRole("img", { name: "Оценка качества промпта: 78 из 100" })).toBeInTheDocument();
    expect(screen.getByText("Тон соответствует бренду.")).toBeInTheDocument();
    expect(screen.getByText("Уберите персональные данные клиента.")).toBeInTheDocument();
  });

  it("«Подставить пример» заполняет поля примерами переменных", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Ответ клиенту на обращение", level: 2 });
    await user.click(screen.getByRole("button", { name: "Подставить пример" }));
    expect(screen.getByLabelText(/Сообщение клиента/)).toHaveValue("Заказ не пришёл вовремя");
    expect(screen.getByLabelText(/Подпись/)).toHaveValue("Команда поддержки");
    await screen.findByTestId("rendered-prompt", undefined, { timeout: 2000 });
  });

  it("предупреждения о персональных данных и найденные типы выводятся рядом с результатом", async () => {
    const user = userEvent.setup();
    setup({
      render: { ...rendered, warnings: ["В значениях найдены персональные данные: обезличьте их."], sensitive: { PHONE_RU: 1 } },
    });
    await screen.findByRole("heading", { name: "Ответ клиенту на обращение", level: 2 });
    await user.click(screen.getByRole("button", { name: "Подставить пример" }));
    expect(await screen.findByText("В значениях найдены персональные данные: обезличьте их.", undefined, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText("Телефон × 1")).toBeInTheDocument();
  });

  it("ошибка сервера при сборке показывается списком, а не пустым экраном", async () => {
    const user = userEvent.setup();
    setup({ render: reply(422, { detail: { message: "Проверьте поля", errors: ["Не заполнено поле «Тон ответа»"] } }) });
    await screen.findByRole("heading", { name: "Ответ клиенту на обращение", level: 2 });
    await user.click(screen.getByRole("button", { name: "Подставить пример" }));
    expect(await screen.findByText("Не заполнено поле «Тон ответа»", undefined, { timeout: 2000 })).toBeInTheDocument();
  });

  it("поиск фильтрует список, переключение шаблона меняет форму", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole("heading", { name: "Ответ клиенту на обращение", level: 2 });
    await user.type(screen.getByLabelText("Поиск шаблонов"), "договор");
    const list = screen.getByRole("navigation", { name: "Шаблоны промптов" });
    expect(within(list).queryByRole("button", { name: /Ответ клиенту/ })).toBeNull();
    await user.click(within(list).getByRole("button", { name: /Разбор договора на риски/ }));
    expect(await screen.findByRole("heading", { name: "Разбор договора на риски", level: 2 })).toBeInTheDocument();
    expect(screen.getByLabelText(/Текст договора/)).toBeInTheDocument();
  });
});

describe("PromptsPage: проверка и каркас", () => {
  it("линтер: оценка, оценка-буква, критерии с подсказками, ограничение из-за персональных данных", async () => {
    const user = userEvent.setup();
    const api = setup();
    await user.click(screen.getByRole("tab", { name: "Проверка запроса" }));
    fireEvent.change(screen.getByLabelText(/Текст запроса к модели/), { target: { value: "Напиши письмо. Звонить 89123456789" } });
    await user.click(screen.getByRole("button", { name: "Проверить запрос" }));

    const result = await screen.findByTestId("lint-result");
    expect(api.callsTo("POST", "/api/prompts/lint")[0]?.body).toEqual({ text: "Напиши письмо. Звонить 89123456789" });
    expect(within(result).getByRole("img", { name: "Оценка запроса: 42 из 100" })).toBeInTheDocument();
    expect(within(result).getByText("D")).toHaveAttribute("data-grade", "D");
    expect(within(result).getByText("Нужна доработка")).toBeInTheDocument();
    expect(within(result).getByText(/Выполнено:/)).toBeInTheDocument();
    expect(within(result).getByText(/Не выполнено:/)).toBeInTheDocument();
    expect(within(result).getByText("Начните с роли: «Ты — опытный …».")).toBeInTheDocument();
    expect(within(result).getByText(/оценка ограничена/)).toBeInTheDocument();
    expect(within(result).getByText("Телефон × 1")).toBeInTheDocument();
    expect(within(result).getByText("Начните с роли.")).toBeInTheDocument();
  });

  it("каркас: собирает текст и по кнопке «Проверить» отправляет его в линтер", async () => {
    const user = userEvent.setup();
    const api = setup();
    await user.click(screen.getByRole("tab", { name: "Каркас запроса" }));
    await user.type(screen.getByLabelText(/Задача/), "проверить договор");
    await user.type(screen.getByLabelText(/Роль/), "Юрист");
    await user.click(screen.getByRole("button", { name: "Собрать каркас" }));

    expect(await screen.findByTestId("scaffold-text")).toHaveTextContent("Ты — Юрист. Твоя задача — проверить договор.");
    expect(api.callsTo("POST", "/api/prompts/scaffold")[0]?.body).toEqual({ task: "проверить договор", role: "Юрист" });

    await user.click(screen.getByRole("button", { name: "Проверить" }));
    expect(screen.getByRole("tab", { name: "Проверка запроса" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(api.callsTo("POST", "/api/prompts/lint")).toHaveLength(1));
    expect(api.callsTo("POST", "/api/prompts/lint")[0]?.body).toEqual({ text: "Ты — Юрист. Твоя задача — проверить договор." });
    expect(await screen.findByTestId("lint-result")).toBeInTheDocument();
    expect(screen.getByLabelText(/Текст запроса к модели/)).toHaveValue("Ты — Юрист. Твоя задача — проверить договор.");
  });

  it("кнопка «Собрать каркас» недоступна, пока задача короче трёх символов", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: "Каркас запроса" }));
    const button = screen.getByRole("button", { name: "Собрать каркас" });
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/Задача/), "ab");
    expect(button).toBeDisabled();
    await user.type(screen.getByLabelText(/Задача/), "c");
    expect(button).toBeEnabled();
  });
});
