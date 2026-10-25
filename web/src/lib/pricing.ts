import type { CostBreakdown, FeaturedModel } from "../api/types";
import { DASH, NBSP, formatDollars, formatNumber } from "./format";

export type Currency = FeaturedModel["currency"];

export interface PriceBasis {
  currency: Currency;
  vatIncluded: boolean;
}

type ProfileBasis = Pick<FeaturedModel, "currency" | "vat_included">;

/** Валюта и налоговая база прямого тарифа: берутся из расчёта, а если его нет — из профиля модели. */
export function priceBasis(cost: CostBreakdown | null | undefined, profile?: ProfileBasis | null): PriceBasis | null {
  const currency = cost?.currency ?? profile?.currency;
  if (!currency) return null;
  return { currency, vatIncluded: cost?.vat_included ?? profile?.vat_included ?? false };
}

/** «с НДС» у российских тарифов, «без налогов» у долларовых. */
export function taxNote({ currency, vatIncluded }: PriceBasis): string {
  if (vatIncluded) return "с НДС";
  return currency === "USD" ? "без налогов" : "без НДС";
}

/** Пара тарифов за 1 млн токенов в валюте провайдера: «800 / 800 ₽» или «$2 / $10». */
export function formatRatePair(
  input: number | null | undefined,
  output: number | null | undefined,
  currency: Currency,
): string {
  if (input == null || output == null) return DASH;
  if (currency === "USD") return `${formatDollars(input)} / ${formatDollars(output)}`;
  return `${formatNumber(input, 2)} / ${formatNumber(output, 2)}${NBSP}₽`;
}

/** «800 / 800 ₽ с НДС» или «$2 / $10 без налогов»; null, если тариф в расчёте не указан. */
export function describeTariff(cost: CostBreakdown | null | undefined, profile?: ProfileBasis | null): string | null {
  const basis = priceBasis(cost, profile);
  if (!basis || cost?.input_rate == null || cost.output_rate == null) return null;
  return `${formatRatePair(cost.input_rate, cost.output_rate, basis.currency)} ${taxNote(basis)}`;
}
