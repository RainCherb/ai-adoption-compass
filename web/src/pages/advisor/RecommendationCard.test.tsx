import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Recommendation } from "../../api/types";
import { primaryAdvice } from "../../test/primaryAdvice";
import { renderWithMeta } from "../../test/render";
import { RecommendationCard } from "./RecommendationCard";

const rubleRecommendation = primaryAdvice.recommendations[0]!;

function dollarRecommendation(overrides: Partial<Recommendation["cost"]> = {}): Recommendation {
  const option = primaryAdvice.model_options!.find((o) => o.model_id === "claude-sonnet-5-5")!;
  return {
    ...rubleRecommendation,
    model_id: option.model_id,
    name: option.name,
    vendor: "Anthropic",
    tier: "flagship",
    deployment: "foreign_cloud",
    ru_access: "workaround",
    quality: option.quality,
    cost: { ...option.cost!, ...overrides },
    profile: option.profile,
  };
}

describe("RecommendationCard", () => {
  it("российская модель: рубли с НДС без пересчёта из долларов", () => {
    renderWithMeta(<RecommendationCard item={rubleRecommendation} />);
    const card = within(screen.getByTestId("recommendation"));
    expect(card.getByText("494 ₽", { selector: "strong" })).toBeInTheDocument();
    expect(card.getByText(/10 000 запросов · только API/)).toBeInTheDocument();
    expect(card.getByText("тариф в рублях с НДС · Стандартный тариф, без кэша")).toBeInTheDocument();
    expect(card.getByText("В России: да")).toBeInTheDocument();
    expect(card.queryByText(/без налогов/)).not.toBeInTheDocument();
    expect(card.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("зарубежная модель: цена в долларах без налогов рядом с рублёвой", () => {
    renderWithMeta(<RecommendationCard item={dollarRecommendation()} />);
    const card = within(screen.getByTestId("recommendation"));
    expect(card.getByText("1 611 ₽", { selector: "strong" })).toBeInTheDocument();
    expect(card.getByText("≈ $20/мес. без налогов · Стандартный тариф, без кэша")).toBeInTheDocument();
    expect(card.getByText("В России: нет")).toBeInTheDocument();
  });

  it("предупреждение об устаревшем тарифе показывается в карточке", () => {
    renderWithMeta(
      <RecommendationCard item={dollarRecommendation({ price_warning: "Тариф сверен 130 дней назад — проверьте актуальность." })} />,
    );
    expect(
      within(screen.getByTestId("recommendation")).getByText("Тариф сверен 130 дней назад — проверьте актуальность."),
    ).toBeInTheDocument();
  });

  it("без предупреждения лишнего блока нет", () => {
    renderWithMeta(<RecommendationCard item={rubleRecommendation} />);
    expect(screen.queryByText(/Тариф сверен/)).not.toBeInTheDocument();
  });

  it("шкала цены объясняет, что 100 % — самая дешёвая из подходящих", () => {
    renderWithMeta(<RecommendationCard item={rubleRecommendation} />);
    const label = within(screen.getByTestId("recommendation")).getByText("Цена");
    expect(label).toHaveAttribute("title", expect.stringContaining("100 % — самая дешёвая из подходящих моделей"));
  });

  it("лимит выхода: у российской модели провайдер его не публикует", () => {
    renderWithMeta(<RecommendationCard item={rubleRecommendation} />);
    expect(screen.getByTestId("recommendation")).toHaveTextContent("Выход: предел не публикуется.");
  });

  it("лимит выхода: у зарубежной модели указан числом", () => {
    renderWithMeta(<RecommendationCard item={dollarRecommendation()} />);
    expect(screen.getByTestId("recommendation")).toHaveTextContent("Выход: до 128 000 токенов.");
  });
});
