import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { primaryAdvice } from "../../test/primaryAdvice";
import { ModelCostChart } from "../../pages/advisor/ModelCostChart";
import { ModelFacts, RussiaAccess } from "../../pages/advisor/RussiaAccess";
import { CashflowChart, cashflowAt } from "./CashflowChart";

const USD_RUB = primaryAdvice.usd_rub;

function chartRows() {
  return within(screen.getByRole("list", { name: "Сравнение стоимости моделей" })).getAllByRole("listitem");
}

function rowOf(name: string) {
  const row = chartRows().find((item) => within(item).queryByText(name, { selector: "strong" }));
  if (!row) throw new Error(`Нет строки «${name}»`);
  return within(row);
}

it("график считает в рублях: российские тарифы с НДС, зарубежные — доллары справочно, строки по росту цены", () => {
  render(<ModelCostChart items={primaryAdvice.model_options!} usdRub={USD_RUB} />);
  expect(chartRows().map((item) => item.querySelector("strong")?.textContent)).toEqual([
    "Claude Haiku 5.5",
    "GPT-6 Luna",
    "DeepSeek V4.1 Flash",
    "GigaChat 2 Lite",
    "DeepSeek V4 Pro",
    "Claude Sonnet 5.5",
    "GPT-6.1 Sol",
    "GigaChat 2 Pro",
    "Alice AI LLM",
    "GigaChat 2 Max",
    "YandexGPT Pro 5.1",
  ]);

  const yandex = rowOf("YandexGPT Pro 5.1");
  expect(yandex.getByText("6 080 ₽", { selector: "strong" })).toBeInTheDocument();
  expect(yandex.getByText("цена с НДС")).toBeInTheDocument();
  expect(yandex.getByText("В России: да")).toBeInTheDocument();
  expect(
    yandex.getByRole("img", { name: /YandexGPT Pro 5\.1: вход 5\s600\s₽, выход 480\s₽, всего 6\s080\s₽/ }),
  ).toBeInTheDocument();

  const sonnet = rowOf("Claude Sonnet 5.5");
  expect(sonnet.getByText("1 611 ₽", { selector: "strong" })).toBeInTheDocument();
  expect(sonnet.getByText("≈ $20 без налогов")).toBeInTheDocument();
  expect(sonnet.getByText("В России: нет")).toBeInTheDocument();
  expect(rowOf("DeepSeek V4.1 Flash").getByText("В России: не подтверждено")).toBeInTheDocument();
});

it("подпись объясняет валюты и курс, а переключатель пересчитывает месяц, тысячу запросов и год", async () => {
  const user = userEvent.setup();
  render(<ModelCostChart items={primaryAdvice.model_options!} usdRub={USD_RUB} />);
  expect(screen.getByRole("heading", { name: "Сколько стоит одинаковая нагрузка" })).toBeInTheDocument();
  expect(screen.getByText(/Российские тарифы — в рублях с НДС 22 %, зарубежные — в долларах без налогов/)).toBeInTheDocument();
  expect(screen.getByText(/пересчёт по курсу 80,54 ₽\/\$/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "За 1 000 запросов" }));
  expect(rowOf("YandexGPT Pro 5.1").getByText("608 ₽", { selector: "strong" })).toBeInTheDocument();
  expect(rowOf("Claude Sonnet 5.5").getByText("≈ $2 без налогов")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "В год" }));
  expect(rowOf("YandexGPT Pro 5.1").getByText("72 960 ₽", { selector: "strong" })).toBeInTheDocument();
  expect(rowOf("Claude Sonnet 5.5").getByText("≈ $240 без налогов")).toBeInTheDocument();
  expect(
    rowOf("YandexGPT Pro 5.1").getByRole("img", {
      name: /вход 67\s200\s₽, выход 5\s760\s₽, всего 72\s960\s₽/,
    }),
  ).toBeInTheDocument();
});

it("аннотация показывает вход, выход и кратность к самой дешёвой подходящей; неподходящим — причина без кратности", () => {
  render(<ModelCostChart items={primaryAdvice.model_options!} usdRub={USD_RUB} />);
  expect(rowOf("GigaChat 2 Lite").getByText(/^Вход 455 ₽ · выход 39 ₽ · 1× цены самой дешёвой подходящей$/)).toBeInTheDocument();
  expect(rowOf("YandexGPT Pro 5.1").getByText(/^Вход 5 600 ₽ · выход 480 ₽ · 12,31× цены самой дешёвой подходящей$/)).toBeInTheDocument();

  const haiku = rowOf("Claude Haiku 5.5");
  expect(haiku.getByText(/Вход 56,38 ₽ · выход 24,16 ₽/)).toBeInTheDocument();
  expect(haiku.queryByText(/цены самой дешёвой/)).not.toBeInTheDocument();
  expect(haiku.getByText(/не подходит: Доступ из РФ только через обходные пути/)).toBeInTheDocument();
  expect(rowOf("GigaChat 2 Lite").queryByText(/не подходит/)).not.toBeInTheDocument();
});

it("без подходящих моделей кратность не показывается: сравнивать не с чем", () => {
  const none = primaryAdvice.model_options!.map((option) => ({ ...option, eligible: false, reasons: ["Бюджет"] }));
  render(<ModelCostChart items={none} usdRub={USD_RUB} />);
  expect(screen.queryByText(/цены самой дешёвой/)).not.toBeInTheDocument();
  expect(screen.getAllByText(/не подходит: Бюджет/)).toHaveLength(11);
});

it("предупреждение об устаревшем тарифе показывается рядом с ценой", () => {
  const items = primaryAdvice.model_options!.map((option) =>
    option.model_id === "alice-ai-llm"
      ? { ...option, cost: { ...option.cost!, price_warning: "Тариф сверен 130 дней назад — проверьте актуальность." } }
      : option,
  );
  render(<ModelCostChart items={items} usdRub={USD_RUB} />);
  expect(rowOf("Alice AI LLM").getByText("Тариф сверен 130 дней назад — проверьте актуальность.")).toBeInTheDocument();
  expect(screen.getAllByText(/Тариф сверен/)).toHaveLength(1);
});

it("источник без подтверждённой цены не превращается на графике в бесплатную модель и уходит в конец", () => {
  const items = primaryAdvice.model_options!.map((row) =>
    row.model_id === "gigachat-2-lite" ? { ...row, cost: null, eligible: false, reasons: ["Источник устарел"] } : row,
  );
  render(<ModelCostChart items={items} usdRub={USD_RUB} />);
  expect(screen.getAllByRole("img")).toHaveLength(10);
  expect(screen.getByText(/Расчёт недоступен: Источник устарел/)).toBeInTheDocument();
  expect(chartRows().at(-1)).toHaveTextContent("GigaChat 2 Lite");
});

it("нулевой выход и очень маленькая платная нагрузка не скрываются округлением", () => {
  const row = primaryAdvice.model_options!.find((option) => option.model_id === "claude-sonnet-5-5")!;
  render(
    <ModelCostChart
      items={[
        {
          ...row,
          cost: { ...row.cost!, total_usd: 0.000002, input_rub: 0.000162, output_rub: 0, total_rub: 0.000162, requests_per_month: 1 },
        },
      ]}
      usdRub={USD_RUB}
    />,
  );
  expect(
    screen.getByRole("img", { name: /Claude Sonnet 5\.5: вход 0,000162\s₽, выход 0\s₽, всего 0,000162\s₽/ }),
  ).toBeInTheDocument();
  expect(screen.getByText("≈ $0,000002 без налогов")).toBeInTheDocument();
});

it("доступность в России отделена от цены и не выдаёт неизвестное за доступное", () => {
  render(
    <>
      {primaryAdvice.model_options!.map((row) => (
        <article key={row.model_id} aria-label={row.name}>
          <RussiaAccess profile={row.profile} />
          <ModelFacts profile={row.profile} />
        </article>
      ))}
    </>,
  );
  const article = (name: string) => within(screen.getByRole("article", { name }));
  expect(article("YandexGPT Pro 5.1").getByText("В России: да")).toBeInTheDocument();
  expect(article("Claude Sonnet 5.5").getByText("В России: нет")).toBeInTheDocument();
  expect(article("GPT-6.1 Sol").getByText("В России: нет")).toBeInTheDocument();
  expect(article("DeepSeek V4.1 Flash").getByText("В России: не подтверждено")).toBeInTheDocument();
});

it("предел выхода: число из профиля или «не публикуется», если провайдер его не называет", () => {
  render(
    <>
      {primaryAdvice.model_options!.map((row) => (
        <article key={row.model_id} aria-label={row.name}>
          <ModelFacts profile={row.profile} />
        </article>
      ))}
    </>,
  );
  expect(screen.getByRole("article", { name: "YandexGPT Pro 5.1" })).toHaveTextContent("Выход: предел не публикуется.");
  expect(screen.getByRole("article", { name: "Claude Sonnet 5.5" })).toHaveTextContent("Выход: до 128 000 токенов.");
});

const row = {
  key: "base",
  label: "Базовый",
  implementation_rub: 100000,
  net_month_rub: 25000,
  net_horizon_rub: 200000,
  payback_months: 4,
};
it("денежный график учитывает внедрение в месяце ноль и достигает точного итога сервера", () => {
  expect(cashflowAt(row, 0, 12)).toBe(-100000);
  expect(cashflowAt(row, 4, 12)).toBe(0);
  expect(cashflowAt(row, 12, 12)).toBe(200000);
  render(<CashflowChart rows={[row]} horizon={12} />);
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: "0" } });
  expect(screen.getByRole("table")).toHaveTextContent("−100 000 ₽");
  fireEvent.change(slider, { target: { value: "4" } });
  expect(screen.getByRole("table")).toHaveTextContent("0 ₽");
});

it("убыточный сценарий остаётся ниже нуля, а пустые данные не дают фиктивного графика", () => {
  const loss = { ...row, net_horizon_rub: -130000, payback_months: null };
  expect(cashflowAt(loss, 12, 12)).toBe(-130000);
  const { rerender } = render(<CashflowChart rows={[loss]} horizon={12} />);
  expect(screen.getByText("Не окупается")).toBeInTheDocument();
  rerender(
    <CashflowChart
      rows={[
        {
          ...row,
          implementation_rub: 0,
          net_month_rub: 0,
          net_horizon_rub: 0,
          payback_months: null,
        },
      ]}
      horizon={12}
    />,
  );
  expect(within(screen.getByRole("img")).getByText("0 ₽")).toBeInTheDocument();
  expect(within(screen.getByRole("img")).getByText("1 ₽")).toBeInTheDocument();
  rerender(<CashflowChart rows={[]} horizon={12} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

it("коды причин превращаются в короткие подписи", () => {
  const items = primaryAdvice.model_options!.map((option) =>
    option.eligible ? option : { ...option, kinds: ["access", "policy"] },
  );
  render(<ModelCostChart items={items} usdRub={USD_RUB} />);
  expect(
    rowOf("Claude Haiku 5.5").getByText(/не подходит: нет прямого доступа из РФ, запрещено политикой данных/),
  ).toBeInTheDocument();
});
