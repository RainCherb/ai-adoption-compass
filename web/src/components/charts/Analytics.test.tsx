import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { primaryAdvice } from "../../test/primaryAdvice";
import { ModelCostChart } from "../../pages/advisor/ModelCostChart";
import { ModelFacts, RussiaAccess } from "../../pages/advisor/RussiaAccess";
import { CashflowChart, cashflowAt } from "./CashflowChart";

it("график стоимости использует тот же вход/выход и пересчитывает месяц, тысячу и год", async () => {
  const user = userEvent.setup();
  render(<ModelCostChart items={primaryAdvice.model_options!} />);
  expect(
    screen.getByRole("img", {
      name: "Claude Sonnet 5.5: вход 20 $, выход 30 $, всего 50 $",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("img", {
      name: "DeepSeek V4.1 Flash: вход 3 $, выход 3,6 $, всего 6,6 $",
    }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "За 1 000 запросов" }));
  expect(
    screen.getByRole("img", {
      name: "Claude Sonnet 5.5: вход 2 $, выход 3 $, всего 5 $",
    }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "В год" }));
  expect(
    screen.getByRole("img", {
      name: "DeepSeek V4.1 Flash: вход 36 $, выход 43,2 $, всего 79,2 $",
    }),
  ).toBeInTheDocument();
});

it("источник без подтверждённой цены не превращается на графике в бесплатную модель", () => {
  render(
    <ModelCostChart
      items={primaryAdvice.model_options!.map((row) => ({
        ...row,
        cost: null,
        eligible: false,
        reasons: ["Источник устарел"],
      }))}
    />,
  );
  expect(screen.queryAllByRole("img")).toHaveLength(0);
  expect(
    screen.getAllByText(/Расчёт недоступен: Источник устарел/),
  ).toHaveLength(3);
});

it("нулевой выход и очень маленькая платная нагрузка не скрываются округлением", () => {
  const row = primaryAdvice.model_options![0]!;
  render(
    <ModelCostChart
      items={[
        {
          ...row,
          cost: {
            ...row.cost!,
            total_usd: 0.000002,
            input_usd: 0.000002,
            output_usd: 0,
            total_rub: 0,
            requests_per_month: 1,
          },
        },
      ]}
    />,
  );
  expect(
    screen.getByRole("img", {
      name: "Claude Sonnet 5.5: вход 0,000002 $, выход 0 $, всего 0,000002 $",
    }),
  ).toBeInTheDocument();
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
  expect(
    within(
      screen.getByRole("article", { name: "Claude Sonnet 5.5" }),
    ).getByText("В России: нет"),
  ).toBeInTheDocument();
  expect(
    within(screen.getByRole("article", { name: "GPT-6.1 Sol" })).getByText(
      "В России: нет",
    ),
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("article", { name: "DeepSeek V4.1 Flash" }),
    ).getByText("В России: не подтверждено"),
  ).toBeInTheDocument();
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
  rerender(<CashflowChart rows={[]} horizon={12} />);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
