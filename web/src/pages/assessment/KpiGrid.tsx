import type { PortfolioSummary } from "../../api/types";
import {
  formatFte,
  formatHours,
  formatMonths,
  formatNumber,
  formatPercentValue,
  formatRub,
  formatRubCompact,
} from "../../lib/format";

interface Kpi {
  id: string;
  label: string;
  value: string;
  full?: string;
  note: string;
  tone?: "good" | "bad";
}

function buildKpis(summary: PortfolioSummary, horizon: number): Kpi[] {
  return [
    {
      id: "hours",
      label: "Экономия времени",
      value: `${formatNumber(summary.hours_saved_month, 0)}\u00A0ч/мес`,
      note: `≈ ${formatFte(summary.fte_equivalent)} из ${formatHours(summary.total_hours_month, 0)} ручной работы`,
    },
    {
      id: "net",
      label: `Эффект за ${horizon} мес.`,
      value: formatRubCompact(summary.net_horizon_rub),
      full: formatRub(summary.net_horizon_rub),
      note: `чистый: ${formatRub(summary.net_month_rub)} в месяц после затрат на модели`,
      tone: summary.net_horizon_rub >= 0 ? "good" : "bad",
    },
    {
      id: "payback",
      label: "Окупаемость",
      value: formatMonths(summary.payback_months),
      note: summary.payback_months === null ? "портфель не окупается" : "срок возврата затрат на внедрение",
    },
    {
      id: "implementation",
      label: "Внедрение",
      value: formatRubCompact(summary.implementation_rub),
      full: formatRub(summary.implementation_rub),
      note: `разовые затраты · эксплуатация ${formatRub(summary.cost_month_rub)} в месяц`,
    },
    {
      id: "roi",
      label: "ROI",
      value: formatPercentValue(summary.roi_pct),
      note: `за ${horizon} мес. · рекомендовано ${summary.recommended_count} из ${summary.processes_total}`,
      tone: summary.roi_pct >= 0 ? "good" : "bad",
    },
  ];
}

export function KpiGrid({ summary, horizon }: { summary: PortfolioSummary; horizon: number }) {
  return (
    <ul className="kpi-grid" aria-label="Ключевые показатели">
      {buildKpis(summary, horizon).map((kpi) => (
        <li key={kpi.id} className="kpi" data-testid={`kpi-${kpi.id}`}>
          <span className="kpi__label">{kpi.label}</span>
          <strong className="kpi__value num" data-tone={kpi.tone} title={kpi.full}>
            {kpi.value}
          </strong>
          <span className="kpi__note">{kpi.note}</span>
        </li>
      ))}
    </ul>
  );
}
