import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MetaContext } from "../../hooks/useMeta";
import { defaultAssumptions, meta, processResult } from "../../test/fixtures";
import { primaryAdvice } from "../../test/primaryAdvice";
import { mockFetch } from "../../test/mockFetch";
import { AssumptionsPanel } from "../assessment/AssumptionsPanel";
import { ProcessDrawer } from "../assessment/ProcessDrawer";
import { AdvisorPage } from "./AdvisorPage";

it("публичный подбор показывает три базовые модели в порядке и передаёт новые ограничения", async () => {
  const user = userEvent.setup();
  const api = mockFetch([{method:"POST",path:"/api/advice",reply:primaryAdvice}]);
  render(<MetaContext.Provider value={{...meta,demo_mode:true}}><AdvisorPage /></MetaContext.Provider>);
  const cards = await screen.findAllByTestId("recommendation");
  expect(cards.map((c) => within(c).getByRole("heading").textContent)).toEqual(["Claude Sonnet 5.5","GPT-6.1 Sol","DeepSeek V4.1 Flash"]);
  expect(api.callsTo("POST","/api/advice")[0]?.body).toMatchObject({data_sensitivity:"public",supported_region:true,prefer:"quality",tokens_in:1000,tokens_out:300,deepseek_period:"peak"});
  const table = screen.getByRole("region",{name:"Стоимость и оценки моделей"});
  expect(within(table).getAllByRole("row")).toHaveLength(4);
  expect(table).toHaveTextContent("6,6 $ / 594 ₽");
  expect(table).toHaveTextContent("Качество, экспертно");
  await user.selectOptions(screen.getByLabelText("Тариф DeepSeek"),"off_peak");
  await waitFor(() => expect(api.callsTo("POST","/api/advice").at(-1)?.body).toMatchObject({deepseek_period:"off_peak"}));
});

it("карточка процесса содержит три тарифных альтернативы и выбранную стоимость USD", () => {
  const first = primaryAdvice.recommendations[0]!;
  render(<MetaContext.Provider value={meta}><ProcessDrawer process={processResult({model_options:primaryAdvice.model_options,model:{...first}})} assumptions={defaultAssumptions} infra={[]} onClose={vi.fn()} /></MetaContext.Provider>);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("region",{name:"Сравнение трёх базовых моделей"})).toHaveTextContent("Claude Sonnet 5.5");
  expect(dialog).toHaveTextContent("DeepSeek V4.1 Flash");
  expect(dialog).toHaveTextContent("API: $50/мес");
  expect(dialog).toHaveTextContent("Качество для задачи, экспертно");
});

it("общие допущения сохраняют приоритет, период и поддерживаемый регион при пересчёте", async () => {
  const user = userEvent.setup(); const recalculate = vi.fn();
  render(<AssumptionsPanel baseline={defaultAssumptions} defaults={defaultAssumptions} whatIfActive={false} busy={false} error={undefined} onRecalculate={recalculate} onReset={vi.fn()} />);
  await user.click(screen.getByRole("button",{name:/Допущения/}));
  await user.selectOptions(screen.getByLabelText("Приоритет подбора"),"cost");
  await user.selectOptions(screen.getByLabelText("Тариф DeepSeek"),"off_peak");
  await user.click(screen.getByRole("checkbox",{name:/Предположить доступный аккаунт/}));
  await user.click(screen.getByRole("button",{name:"Пересчитать"}));
  expect(recalculate).toHaveBeenCalledWith(expect.objectContaining({model_preference:"cost",deepseek_period:"off_peak",supported_region:true,usd_rub:90}));
});
