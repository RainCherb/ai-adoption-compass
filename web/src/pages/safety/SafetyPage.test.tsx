import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeRequest } from "../../api/types";
import { analysis, analysisText, policy } from "../../test/fixtures";
import { mockFetch, reply } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { SafetyPage } from "./SafetyPage";

function setup(analyzeReply: unknown = analysis) {
  const api = mockFetch([
    { method: "POST", path: "/api/safety/analyze", reply: analyzeReply },
    {
      method: "POST",
      path: "/api/safety/unmask",
      handle: (request) => ({ text: String((request.body as { text: string }).text).replace("[PHONE_1]", "+7 (999) 123-45-67") }),
    },
    { path: "/api/safety/policy", reply: policy },
  ]);
  renderWithMeta(<SafetyPage />);
  return api;
}

async function analyze(user: ReturnType<typeof userEvent.setup>) {
  const textarea = screen.getByLabelText(/Текст для проверки/);
  // fireEvent.change вместо user.type: текст с эмодзи вставляется целиком, как при вставке из буфера
  fireEvent.change(textarea, { target: { value: analysisText } });
  await user.click(screen.getByRole("button", { name: "Проверить" }));
  return screen.findByTestId("analysis-result");
}

describe("SafetyPage: проверка текста", () => {
  it("отправляет текст с mapping и показывает подсвеченные находки по кодовым точкам (эмодзи не сдвигает подсветку)", async () => {
    const user = userEvent.setup();
    const api = setup();
    await analyze(user);

    const [call] = api.callsTo("POST", "/api/safety/analyze");
    expect(call?.body).toEqual({ text: analysisText, declared_sensitivity: "internal", include_mapping: true } satisfies AnalyzeRequest);

    const marks = Array.from(screen.getByTestId("highlighted-text").querySelectorAll("mark"));
    expect(marks.map((mark) => mark.textContent)).toEqual(["+7 (999) 123-45-67", "ivan@example.com"]);
    expect(marks[0]).toHaveAttribute("title", "Телефон · уверенность: высокая");
    expect(marks[1]).toHaveAttribute("data-kind", "EMAIL");
    // весь исходный текст сохранён, включая эмодзи
    expect(screen.getByTestId("highlighted-text")).toHaveTextContent("Привет 😀! Звоните");
  });

  it("секреты подсвечиваются красным классом и помечаются бейджем", async () => {
    const user = userEvent.setup();
    const secret = {
      ...analysis,
      has_secrets: true,
      counts: { API_KEY: 1 },
      findings: [{ ...analysis.findings[0]!, kind: "API_KEY", label: "Ключ API", is_secret: true, start: 0, end: 6 }],
    };
    setup(secret);
    await analyze(user);
    expect(screen.getByTestId("highlighted-text").querySelector("mark")).toHaveClass("mark--secret");
    expect(screen.getByText("найдены секреты")).toBeInTheDocument();
  });

  it("показывает счётчики, категории и две карточки решений API с действием и причинами", async () => {
    const user = userEvent.setup();
    setup();
    await analyze(user);

    expect(screen.getByText("Найдено: 2")).toBeInTheDocument();
    expect(screen.getByText("Телефон × 1")).toBeInTheDocument();
    expect(screen.getByText("E-mail × 1")).toBeInTheDocument();
    expect(screen.getByText("Заявлено").nextElementSibling).toHaveTextContent("Внутренние");
    expect(screen.getByText("Итоговая категория").nextElementSibling).toHaveTextContent("Персональные");

    const cards = screen.getAllByTestId("decision-card");
    expect(cards.map((card) => card.getAttribute("data-action"))).toEqual(["mask", "deny"]);
    expect(within(cards[0] as HTMLElement).getByRole("heading", { name: "Российское облако" })).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText("После обезличивания")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText("Нельзя")).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText("Отправка за рубеж запрещена политикой.")).toBeInTheDocument();
    expect(cards).toHaveLength(2);
    expect(screen.getByTestId("masked-text")).toHaveTextContent("Звоните [PHONE_1], почта [EMAIL_1]");
  });

  it("«Вернуть значения» отправляет ответ модели и mapping в /api/safety/unmask", async () => {
    const user = userEvent.setup();
    const api = setup();
    await analyze(user);

    fireEvent.change(screen.getByLabelText(/Ответ модели с метками/), { target: { value: "Свяжитесь по [PHONE_1]" } });
    await user.click(screen.getByRole("button", { name: "Вернуть значения" }));

    const result = await screen.findByTestId("unmasked");
    expect(result).toHaveTextContent("Свяжитесь по +7 (999) 123-45-67");
    expect(api.callsTo("POST", "/api/safety/unmask")[0]?.body).toEqual({
      text: "Свяжитесь по [PHONE_1]",
      mapping: analysis.mapping,
    });
  });

  it("«Вставить пример» подставляет синтетический текст с эмодзи и сразу проверяет его", async () => {
    const user = userEvent.setup();
    const api = setup();
    await user.click(screen.getByRole("button", { name: "Вставить пример" }));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(/Текст для проверки/);
    expect(textarea.value).toContain("😊");
    expect(textarea.value).toContain("example.com");
    await waitFor(() => expect(api.callsTo("POST", "/api/safety/analyze")).toHaveLength(1));
    await screen.findByTestId("analysis-result");
  });

  it("выбранная заявленная категория уходит в запрос", async () => {
    const user = userEvent.setup();
    const api = setup();
    await user.selectOptions(screen.getByLabelText("Категория данных (заявленная)"), "confidential");
    await analyze(user);
    expect(api.callsTo("POST", "/api/safety/analyze")[0]?.body).toMatchObject({ declared_sensitivity: "confidential" });
  });

  it("живой режим проверяет текст после паузы без нажатия кнопки", async () => {
    const api = setup();
    fireEvent.change(screen.getByLabelText(/Текст для проверки/), { target: { value: analysisText } });
    expect(api.callsTo("POST", "/api/safety/analyze")).toHaveLength(0);
    await screen.findByTestId("analysis-result", undefined, { timeout: 2000 });
    expect(api.callsTo("POST", "/api/safety/analyze")).toHaveLength(1);
  });

  it("ошибка API показывается баннером с повтором", async () => {
    const user = userEvent.setup();
    setup(reply(413, { detail: "Текст длиннее 200000 символов" }));
    fireEvent.change(screen.getByLabelText(/Текст для проверки/), { target: { value: "x" } });
    await user.click(screen.getByRole("button", { name: "Проверить" }));
    expect(await screen.findByText("Текст длиннее 200000 символов")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });
});

describe("SafetyPage: политика", () => {
  afterEach(() => {
    Reflect.deleteProperty(URL, "createObjectURL");
    Reflect.deleteProperty(URL, "revokeObjectURL");
  });

  it("показывает матрицу «категория × контур», правила и качает памятку из handout_markdown", async () => {
    const user = userEvent.setup();
    // jsdom не реализует эти методы URL, поэтому подставляем их на время теста.
    const createObjectURL = vi.fn((_blob: Blob) => "blob:memo");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    setup();
    await user.click(screen.getByRole("tab", { name: "Политика" }));
    const matrix = await screen.findByTestId("policy-matrix");
    const personal = within(matrix).getByRole("rowheader", { name: /Персональные/ }).closest("tr") as HTMLElement;
    expect(within(personal).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "После обезличивания",
      "Нельзя",
    ]);
    expect(screen.getByText("Определяйте категорию данных перед отправкой.")).toBeInTheDocument();
    expect(screen.getByText("Не вставляйте пароли и ключи API.")).toBeInTheDocument();
    expect(screen.getByText("Найдены секреты: их нельзя передавать ни в одну модель.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Скачать памятку (.md)" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await expect(createObjectURL.mock.calls[0]?.[0].text()).resolves.toBe(policy.handout_markdown);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:memo");
  });
});
