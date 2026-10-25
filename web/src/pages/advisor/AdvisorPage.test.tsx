import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Workload } from "../../api/types";
import { advice, catalog, meta } from "../../test/fixtures";
import { primaryAdvice, primaryCatalog } from "../../test/primaryAdvice";
import { mockFetch, reply } from "../../test/mockFetch";
import { renderWithMeta } from "../../test/render";
import { AdvisorPage } from "./AdvisorPage";

function setup(adviceReply: unknown = advice) {
  const api = mockFetch([
    { method: "POST", path: "/api/advice", reply: adviceReply },
    { path: "/api/catalog", reply: catalog },
    { path: "/api/catalog/sources", reply: { sources: [], disclaimer: "Проверяемые источники" } },
  ]);
  renderWithMeta(<AdvisorPage />);
  const adviceCalls = () => api.callsTo("POST", "/api/advice");
  return { api, adviceCalls };
}

describe("AdvisorPage: результаты", () => {
  it("при открытии сам запрашивает подбор с параметрами по умолчанию и показывает карточки по рангу", async () => {
    const { adviceCalls } = setup();
    const cards = await screen.findAllByTestId("recommendation");
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByRole("heading", { name: "Сбер GigaChat — лёгкий класс" })).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByRole("heading", { name: "Yandex Cloud YandexGPT — Pro-класс" })).toBeInTheDocument();

    expect(adviceCalls()).toHaveLength(1);
    const call = adviceCalls()[0];
    expect(call?.search.get("top")).toBe("5");
    expect(call?.body).toMatchObject({
      task_type: "classification",
      requests_per_month: 10000,
      tokens_in: 700,
      tokens_out: 60,
      data_sensitivity: "internal",
      prefer: "balanced",
      monthly_budget_rub: null,
    });
  });

  it("карточка показывает оценку, стоимость, разбивку на четыре части, плюсы и минусы", async () => {
    setup();
    const [first] = await screen.findAllByTestId("recommendation");
    const card = within(first as HTMLElement);
    expect(card.getByRole("img", { name: /Итоговая оценка «Сбер GigaChat — лёгкий класс»: 74 из 100/ })).toBeInTheDocument();
    // testing-library нормализует неразрывные пробелы в обычные
    expect(card.getByText("469 ₽", { selector: "strong" })).toBeInTheDocument();
    expect(card.getByText(/переменная 469 ₽ \+ фиксированная 0 ₽/)).toBeInTheDocument();
    expect(card.getAllByRole("meter").map((meter) => meter.getAttribute("aria-label"))).toEqual([
      "Качество",
      "Цена",
      "Безопасность",
      "Доступ",
    ]);
    expect(card.getByText("нужно обезличивание")).toBeInTheDocument();
    expect(card.getByText("Обработка в РФ")).toBeInTheDocument();
    expect(card.getByText("Перед отправкой данные нужно обезличивать")).toBeInTheDocument();
  });

  it("показывает заметный баннер про демонстрационные данные с текстом из meta.catalog.disclaimer", async () => {
    setup();
    await screen.findAllByTestId("recommendation");
    const banner = screen.getByText("Каталог справочный: оценки качества — экспертные допущения").closest(".banner");
    expect(banner).toHaveClass("banner--prominent");
    expect(banner).toHaveTextContent(meta.catalog.disclaimer);
  });

  it("исключённые модели свёрнуты и раскрываются со всеми причинами", async () => {
    const user = userEvent.setup();
    setup();
    await screen.findAllByTestId("recommendation");
    const toggle = screen.getByRole("button", { name: /Исключены/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const items = screen.getAllByTestId("excluded-model");
    expect(items).toHaveLength(2);
    const first = within(items[0] as HTMLElement);
    expect(first.getByText(/для категории «персональные» размещение «Зарубежное облако» запрещено/)).toBeVisible();
    expect(first.getByText("Доступ из РФ только через обходные пути")).toBeVisible();
    expect(first.getByText("политика данных")).toBeInTheDocument();
    expect(first.getByText("доступ из РФ")).toBeInTheDocument();
  });

  it("если подходящих моделей нет, объясняет причины и сразу раскрывает исключённых", async () => {
    setup({ ...advice, recommendations: [], notes: ["Подходящих моделей нет: ни одна не проходит все ограничения."] });
    expect(await screen.findByText("Ни одна модель не проходит все ограничения")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Исключены/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Подходящих моделей нет: ни одна не проходит все ограничения.")).toBeInTheDocument();
  });

  it("ошибка API показывается баннером с понятным текстом и кнопкой «Повторить»", async () => {
    const user = userEvent.setup();
    let fail = true;
    mockFetch([
      {
        method: "POST",
        path: "/api/advice",
        handle: () => (fail ? reply(422, { detail: [{ type: "greater_than", loc: ["body", "requests_per_month"], msg: "x", ctx: { gt: 0 } }] }) : advice),
      },
    ]);
    renderWithMeta(<AdvisorPage />);
    expect(await screen.findByText("Проверьте введённые данные")).toBeInTheDocument();
    expect(screen.getByText("Запросов в месяц: должно быть больше 0")).toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findAllByTestId("recommendation")).toHaveLength(2);
  });
});

describe("AdvisorPage: сводка", () => {
  const recommendations = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      ...advice.recommendations[0]!,
      rank: i + 1,
      model_id: `m${i}`,
      name: `Модель ${i + 1}`,
    }));

  it.each([
    [1, "Подходит 1 модель"],
    [2, "Подходят 2 модели"],
    [4, "Подходят 4 модели"],
    [5, "Подходят 5 моделей"],
    [11, "Подходят 11 моделей"],
    [21, "Подходит 21 модель"],
    [22, "Подходят 22 модели"],
  ])("при %i подходящих моделях сводка согласует глагол: «%s»", async (count, text) => {
    setup({ ...advice, excluded: [], recommendations: recommendations(count) });
    expect(await screen.findByText(new RegExp(`^${text},`))).toBeInTheDocument();
  });

  it("сводка показывает исключённые и курс с двумя знаками", async () => {
    setup();
    expect(await screen.findByText(/Подходят 2 модели, исключено: 2 · курс 80,54 ₽\/\$/)).toBeInTheDocument();
  });

  it("если подходящих нет, сводка так и говорит", async () => {
    setup({ ...advice, recommendations: [] });
    expect(await screen.findByText(/^Подходящих моделей нет · курс/)).toBeInTheDocument();
  });

  it("кнопка «Показать все подходящие» не нужна, когда в списке уже все подходящие модели", async () => {
    const options = primaryAdvice.model_options!;
    setup({ ...primaryAdvice, model_options: options, recommendations: primaryAdvice.recommendations });
    await screen.findAllByTestId("recommendation");
    expect(screen.queryByRole("button", { name: "Показать все подходящие" })).not.toBeInTheDocument();
  });

  it("подходящие считаются по всем моделям, а не только по показанным карточкам", async () => {
    const everyone = primaryAdvice.model_options!.map((option) => ({ ...option, eligible: true, reasons: [] }));
    setup({ ...primaryAdvice, excluded: [], model_options: everyone });
    expect(await screen.findByText(/Подходят 11 моделей, исключено: 0/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Показать все подходящие" })).toBeInTheDocument();
    expect(screen.getAllByTestId("recommendation")).toHaveLength(5);
  });
});

describe("AdvisorPage: форма", () => {
  it("серия быстрых изменений поля даёт один новый запрос после паузы 300 мс, а не запрос на каждый символ", async () => {
    const { adviceCalls } = setup();
    await screen.findAllByTestId("recommendation");
    expect(adviceCalls()).toHaveLength(1);

    // fireEvent: все изменения происходят синхронно, поэтому результат не зависит от скорости машины
    const requests = screen.getByLabelText("Запросов в месяц");
    for (const value of ["2", "25", "250", "2500", "25000"]) fireEvent.change(requests, { target: { value } });
    expect(adviceCalls()).toHaveLength(1);

    await waitFor(() => expect(adviceCalls()).toHaveLength(2));
    expect((adviceCalls()[1]?.body as Workload).requests_per_month).toBe(25000);
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(adviceCalls()).toHaveLength(2);
  });

  it("смена типа задачи подставляет токены и минимальное качество из /api/meta", async () => {
    const user = userEvent.setup();
    const { adviceCalls } = setup();
    await screen.findAllByTestId("recommendation");

    await user.selectOptions(screen.getByLabelText("Тип задачи"), "analysis");
    expect(screen.getByLabelText("Токенов на входе")).toHaveValue("3000");
    expect(screen.getByLabelText("Токенов на выходе")).toHaveValue("800");
    expect(screen.getByRole("radio", { name: "4" })).toBeChecked();

    await waitFor(() => expect(adviceCalls()).toHaveLength(2));
    expect(adviceCalls()[1]?.body).toMatchObject({ task_type: "analysis", tokens_in: 3000, tokens_out: 800, min_quality: 4 });
  });

  it("категория данных, чекбоксы и бюджет попадают в запрос", async () => {
    const user = userEvent.setup();
    const { adviceCalls } = setup();
    await screen.findAllByTestId("recommendation");

    await user.click(screen.getByRole("radio", { name: /Персональные/ }));
    expect(screen.queryByRole("checkbox", { name: "Только self-hosted" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Допускать обходные пути (посредники, зарубежные карты) — риск блокировок" }));
    await user.type(screen.getByLabelText(/Бюджет в месяц/), "50000");
    await user.selectOptions(screen.getByLabelText("Что важнее"), "safety");

    await waitFor(() => expect(adviceCalls().length).toBeGreaterThanOrEqual(2));
    await waitFor(() =>
      expect(adviceCalls().at(-1)?.body).toMatchObject({
        data_sensitivity: "personal",
        must_self_host: false,
        allow_workarounds: true,
        monthly_budget_rub: 50000,
        prefer: "safety",
      }),
    );
  });

  it("некорректные значения подсвечиваются и не уходят на сервер", async () => {
    const user = userEvent.setup();
    const { adviceCalls } = setup();
    await screen.findAllByTestId("recommendation");

    await user.clear(screen.getByLabelText("Запросов в месяц"));
    expect(screen.getByText("Заполните поле")).toBeInTheDocument();
    expect(screen.getByLabelText("Запросов в месяц")).toBeInvalid();
    expect(screen.getByText("Проверьте параметры")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(adviceCalls()).toHaveLength(1);
  });

  it("«Показать все подходящие» запрашивает top=20", async () => {
    const user = userEvent.setup();
    const { adviceCalls } = setup({ ...advice, recommendations: Array.from({ length: 5 }, (_, i) => ({ ...advice.recommendations[0]!, rank: i + 1, model_id: `m${i}`, name: `Модель ${i + 1}` })) });
    await screen.findAllByTestId("recommendation");
    await user.click(screen.getByRole("button", { name: "Показать все подходящие" }));
    await waitFor(() => expect(adviceCalls()).toHaveLength(2));
    expect(adviceCalls()[1]?.search.get("top")).toBe("20");
  });
});

describe("AdvisorPage: каталог", () => {
  it("российские тарифы показаны в рублях с НДС, зарубежные — в долларах без налогов", async () => {
    const user = userEvent.setup();
    mockFetch([
      { method: "POST", path: "/api/advice", reply: advice },
      { path: "/api/catalog", reply: primaryCatalog },
      { path: "/api/catalog/sources", reply: { sources: [], disclaimer: "Проверяемые источники" } },
    ]);
    renderWithMeta(<AdvisorPage />);
    await screen.findAllByTestId("recommendation");
    await user.click(screen.getByRole("tab", { name: "Каталог" }));
    const table = await screen.findByTestId("catalog-table");
    expect(within(table).getAllByRole("row")).toHaveLength(12);
    const yandex = within(within(table).getByText("YandexGPT Pro 5.1").closest("tr") as HTMLElement);
    expect(yandex.getByText("800 / 800 ₽")).toBeInTheDocument();
    expect(yandex.getByText("с НДС")).toBeInTheDocument();
    expect(yandex.getByText("В России: да")).toBeInTheDocument();
    const claude = within(within(table).getByText("Claude Sonnet 5.5").closest("tr") as HTMLElement);
    expect(claude.getByText("$2 / $10")).toBeInTheDocument();
    expect(claude.getByText("без налогов")).toBeInTheDocument();
    expect(within(table).queryByText("Фикс. в месяц")).not.toBeInTheDocument();
    expect(screen.getByText(/курс для пересчёта — 80,54 ₽ за \$1/)).toBeInTheDocument();
  });

  it("вкладка «Каталог» загружает таблицу моделей и берёт качество для выбранной задачи", async () => {
    const user = userEvent.setup();
    const { api } = setup();
    await screen.findAllByTestId("recommendation");
    expect(api.callsTo("GET", "/api/catalog")).toHaveLength(0);

    await user.click(screen.getByRole("tab", { name: "Каталог" }));
    const table = await screen.findByTestId("catalog-table");
    expect(within(table).getByText("OpenAI GPT — флагманский класс")).toBeInTheDocument();
    expect(within(table).getByText("В России: не подтверждено")).toBeInTheDocument();
    expect(within(table).getByText(/Качество, экспертно: Классификация и маршрутизация/)).toBeInTheDocument();
    expect(within(table).getByText("5 из 5")).toBeInTheDocument();
  });
});
