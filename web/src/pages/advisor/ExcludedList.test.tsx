import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Exclusion } from "../../api/types";
import { renderWithMeta } from "../../test/render";
import { ExcludedList } from "./ExcludedList";

const item = (kinds: string[]): Exclusion => ({
  model_id: "m1",
  name: "Claude Sonnet 5.5",
  deployment: "foreign_cloud",
  kinds,
  reasons: ["Причина"],
});

describe("ExcludedList", () => {
  it.each([
    ["policy", "политика данных"],
    ["access", "доступ из РФ"],
    ["foreign", "зарубежное облако"],
    ["self_host", "только self-hosted"],
    ["budget", "бюджет"],
    ["pricing", "тариф"],
  ])("вид причины «%s» показывается по-русски: «%s»", (kind, label) => {
    renderWithMeta(<ExcludedList items={[item([kind])]} defaultOpen />);
    expect(within(screen.getByTestId("excluded-model")).getByText(label)).toBeInTheDocument();
  });

  it("неизвестный вид причины показывается как есть", async () => {
    const user = userEvent.setup();
    renderWithMeta(<ExcludedList items={[item(["новое"])]} />);
    await user.click(screen.getByRole("button", { name: /Исключены/ }));
    expect(screen.getByText("новое")).toBeInTheDocument();
  });

  it("пустой список ничего не выводит", () => {
    const { container } = renderWithMeta(<ExcludedList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
