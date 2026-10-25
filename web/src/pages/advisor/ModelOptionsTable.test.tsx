import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ModelOption } from "../../api/types";
import { primaryAdvice } from "../../test/primaryAdvice";
import { ModelOptionsTable } from "./ModelOptionsTable";

const options = primaryAdvice.model_options!;

function row(name: string) {
  const header = screen.getByRole("rowheader", { name: new RegExp(`^${name.replace(".", "\\.")}`) });
  return within(header.closest("tr") as HTMLElement);
}

describe("ModelOptionsTable", () => {
  it("заголовки столбцов и название не привязаны к трём моделям", () => {
    render(<ModelOptionsTable items={options} />);
    expect(screen.getByRole("heading", { level: 3, name: "Все модели для этой нагрузки" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Сравнение всех моделей для этой нагрузки" })).toBeInTheDocument();
    expect(screen.queryByText(/Три базовые|трёх/)).not.toBeInTheDocument();
    const table = screen.getByRole("region", { name: "Стоимость и оценки моделей" });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Модель и доступ из РФ",
      "Качество",
      "Цена за 1 млн токенов, вход / выход",
      "В месяц",
      "Подходит?",
    ]);
    expect(within(table).getAllByRole("row")).toHaveLength(options.length + 1);
  });

  it("российская модель: рубли с НДС, без долларов", () => {
    render(<ModelOptionsTable items={options} />);
    const yandex = row("YandexGPT Pro 5.1");
    expect(yandex.getByText("Яндекс")).toBeInTheDocument();
    expect(yandex.getByText("gpt://<folder_ID>/yandexgpt/rc")).toBeInTheDocument();
    expect(yandex.getByText("В России: да")).toBeInTheDocument();
    expect(yandex.getByText("4 / 5")).toBeInTheDocument();
    expect(yandex.getByText("800 / 800 ₽ с НДС")).toBeInTheDocument();
    // Стандартный тариф не повторяется в каждой строке — подпись остаётся только для особых условий.
    expect(yandex.queryByText("Стандартный тариф, без кэша")).not.toBeInTheDocument();
    expect(yandex.getByText("6 080 ₽")).toBeInTheDocument();
    expect(yandex.queryByText(/\$/)).not.toBeInTheDocument();
    expect(yandex.getByText("подходит")).toBeInTheDocument();
  });

  it("зарубежная модель: доллары без налогов, рубли и причина, по которой она не подходит", () => {
    render(<ModelOptionsTable items={options} />);
    const claude = row("Claude Sonnet 5.5");
    expect(claude.getByText("$2 / $10 без налогов")).toBeInTheDocument();
    expect(claude.getByText("1 611 ₽")).toBeInTheDocument();
    expect(claude.getByText("$20")).toBeInTheDocument();
    expect(claude.getByText("В России: нет")).toBeInTheDocument();
    expect(claude.getByText("не подходит")).toBeInTheDocument();
    expect(claude.getByText(/Доступ из РФ только через обходные пути/)).toBeInTheDocument();
    expect(claude.queryByText("подходит")).not.toBeInTheDocument();
  });

  it("причины с кодами показываются коротко, полный текст — в свойствах", () => {
    const withKinds = options.map((option) => (option.eligible ? option : { ...option, kinds: ["access"] }));
    render(<ModelOptionsTable items={withKinds} />);
    const claude = row("Claude Sonnet 5.5");
    expect(claude.getByText("нет прямого доступа из РФ")).toBeInTheDocument();
    expect(claude.getByText(/Доступ из РФ только через обходные пути/)).toBeInTheDocument();
  });

  it("свойства и источники: предел выхода, условия и ссылки на официальные страницы", () => {
    render(<ModelOptionsTable items={options} />);
    const yandex = row("YandexGPT Pro 5.1");
    expect(yandex.getByText("Источник и свойства")).toBeInTheDocument();
    expect(yandex.getByText(/Выход: предел не публикуется\./)).toBeInTheDocument();
    expect(yandex.getByText(/Сверено 25\.10\.2026/)).toBeInTheDocument();
    expect(yandex.getByRole("link", { name: "Официальные тарифы ↗" })).toHaveAttribute(
      "href",
      "https://aistudio.yandex.ru/docs/ru/ai-studio/pricing",
    );
    expect(yandex.queryByRole("link", { name: /Доступ в России/ })).not.toBeInTheDocument();

    const claude = row("Claude Sonnet 5.5");
    expect(claude.getByText(/Выход: до 128 000 токенов\./)).toBeInTheDocument();
    expect(claude.getByRole("link", { name: "Доступ в России: официальный источник ↗" })).toHaveAttribute(
      "href",
      "https://platform.claude.com/docs/en/api/supported-regions",
    );
  });

  it("модель без расчёта цены остаётся в таблице, но не получает фиктивную стоимость", () => {
    const items: ModelOption[] = options.map((option) =>
      option.model_id === "alice-ai-llm" ? { ...option, cost: null, eligible: false, reasons: ["Источник устарел"] } : option,
    );
    render(<ModelOptionsTable items={items} />);
    const alice = row("Alice AI LLM");
    expect(alice.getByText("Недоступно")).toBeInTheDocument();
    expect(alice.getByText("Источник устарел")).toBeInTheDocument();
    expect(alice.queryByText("4 220 ₽")).not.toBeInTheDocument();
    expect(alice.queryByText("0 ₽")).not.toBeInTheDocument();
  });

  it("предупреждение об устаревшем тарифе видно рядом с ценой", () => {
    const items: ModelOption[] = options.map((option) =>
      option.model_id === "gpt-6-1-sol"
        ? { ...option, cost: { ...option.cost!, price_warning: "Тариф сверен 130 дней назад." } }
        : option,
    );
    render(<ModelOptionsTable items={items} />);
    expect(row("GPT-6.1 Sol").getByText("Тариф сверен 130 дней назад.")).toBeInTheDocument();
  });

  it("без моделей ничего не выводит", () => {
    const { container } = render(<ModelOptionsTable items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
