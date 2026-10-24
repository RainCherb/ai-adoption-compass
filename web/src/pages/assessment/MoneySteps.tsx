import type { Assumptions, ProcessResult } from "../../api/types";
import { cx } from "../../lib/cx";
import { formatDays, formatHours, formatMonths, formatNumber, formatPercent, formatRub } from "../../lib/format";

interface Step {
  sign: "" | "+" | "−" | "=";
  label: string;
  detail: string;
  amount: string;
  emphasis?: boolean;
  tone?: "good" | "bad";
}

function buildSteps(process: ProcessResult, assumptions: Assumptions): Step[] {
  const hourly = process.hours_per_month > 0 ? process.manual_cost_month_rub / process.hours_per_month : 0;
  const horizon = assumptions.horizon_months;
  return [
    {
      sign: "",
      label: "Ручная работа сейчас",
      detail: `${formatHours(process.hours_per_month)} × ${formatRub(hourly)}/ч`,
      amount: `${formatRub(process.manual_cost_month_rub)}/мес`,
    },
    {
      sign: "",
      label: "Сэкономленное время",
      detail: `доля автоматизации ${formatPercent(process.automation_share, 1)}, после поправки на качество — ${formatPercent(process.net_share, 1)}`,
      amount: `${formatHours(process.hours_saved_month)}/мес`,
    },
    {
      sign: "+",
      label: "Экономия на оплате труда",
      detail: `${formatHours(process.hours_saved_month)} × ${formatRub(hourly)}/ч`,
      amount: formatRub(process.savings_month_rub),
      tone: "good",
    },
    {
      sign: "+",
      label: "Меньше ошибок",
      detail: `ошибки снижаются на ${formatPercent(assumptions.error_reduction)}`,
      amount: formatRub(process.error_savings_month_rub),
      tone: "good",
    },
    {
      sign: "−",
      label: "Стоимость модели",
      detail: "токены × цена, с учётом накладных расходов",
      amount: formatRub(process.llm_cost_month_rub),
      tone: "bad",
    },
    {
      sign: "−",
      label: "Сопровождение",
      detail: `${formatPercent(assumptions.support_share_per_month, 1)} от стоимости внедрения в месяц`,
      amount: formatRub(process.support_month_rub),
      tone: "bad",
    },
    {
      sign: "=",
      label: "Чистый эффект в месяц",
      detail: "экономия − затраты на модель и сопровождение",
      amount: formatRub(process.net_month_rub),
      emphasis: true,
      tone: process.net_month_rub >= 0 ? "good" : "bad",
    },
    {
      sign: "",
      label: "Внедрение (разово)",
      detail: `${formatDays(process.implementation_days)} × ${formatRub(assumptions.implementation_day_rub)}/день`,
      amount: formatRub(process.implementation_rub),
    },
    {
      sign: "=",
      label: "Окупаемость",
      detail: "внедрение ÷ чистый эффект в месяц",
      amount: process.payback_months === null ? "не окупается" : formatMonths(process.payback_months),
      emphasis: true,
    },
    {
      sign: "=",
      label: `Эффект за ${formatNumber(horizon)} мес.`,
      detail: `чистый эффект × ${formatNumber(horizon)} − внедрение`,
      amount: formatRub(process.net_horizon_rub),
      emphasis: true,
      tone: process.net_horizon_rub >= 0 ? "good" : "bad",
    },
  ];
}

/** Денежный расчёт по шагам: от часов ручной работы до окупаемости. */
export function MoneySteps({ process, assumptions }: { process: ProcessResult; assumptions: Assumptions }) {
  return (
    <ol className="steps" data-testid="money-steps">
      {buildSteps(process, assumptions).map((step, index) => (
        <li key={index} className={cx("step", step.emphasis && "step--result")}>
          <span className="step__sign" aria-hidden="true">
            {step.sign}
          </span>
          <div className="step__text">
            <span className="step__label">{step.label}</span>
            <span className="step__detail">{step.detail}</span>
          </div>
          <span className="step__amount num" data-tone={step.tone}>
            {step.amount}
          </span>
        </li>
      ))}
    </ol>
  );
}
