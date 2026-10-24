import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";
import { Drawer } from "./Drawer";
import { InlineConfirm } from "./InlineConfirm";
import { TabPanel, Tabs, useTabs } from "./Tabs";

function DrawerHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Открыть</button>
      {open ? (
        <Drawer
          title="Процесс"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button>Внутри</button>
        </Drawer>
      ) : null}
    </>
  );
}

describe("Drawer", () => {
  it("это модальный диалог с названием; фокус уходит внутрь и возвращается на кнопку", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    const trigger = screen.getByRole("button", { name: "Открыть" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Процесс" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });

  it("возвращает фокус на SVG-элемент (пузырёк диаграммы), с которого панель была открыта", async () => {
    const user = userEvent.setup();
    function SvgTrigger() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <svg>
            <g
              tabIndex={0}
              role="button"
              aria-label="Пузырёк"
              onKeyDown={(event) => {
                if (event.key === "Enter") setOpen(true);
              }}
            />
          </svg>
          {open ? (
            <Drawer title="Процесс" onClose={() => setOpen(false)}>
              <p>Содержимое</p>
            </Drawer>
          ) : null}
        </>
      );
    }
    render(<SvgTrigger />);
    const bubble = screen.getByRole("button", { name: "Пузырёк" });
    bubble.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(bubble).toHaveFocus();
  });

  it("закрывается кнопкой и кликом по затемнению", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DrawerHarness onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Открыть" }));
    await user.click(screen.getByRole("button", { name: "Закрыть панель" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Открыть" }));
    await user.click(document.querySelector(".drawer-backdrop") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("Tab не выводит фокус за пределы панели", async () => {
    const user = userEvent.setup();
    render(<DrawerHarness />);
    await user.click(screen.getByRole("button", { name: "Открыть" }));
    const close = screen.getByRole("button", { name: "Закрыть панель" });
    const inner = screen.getByRole("button", { name: "Внутри" });
    inner.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(inner).toHaveFocus();
  });
});

function TabsHarness() {
  const tabs = useTabs<"one" | "two">("one");
  return (
    <>
      <Tabs
        tabs={tabs}
        prefix="t"
        label="Разделы"
        items={[
          { id: "one", label: "Первая" },
          { id: "two", label: "Вторая" },
        ]}
      />
      <TabPanel tabs={tabs} id="one" prefix="t">
        <input aria-label="поле первой" />
      </TabPanel>
      <TabPanel tabs={tabs} id="two" prefix="t">
        <p>содержимое второй</p>
      </TabPanel>
    </>
  );
}

describe("Tabs", () => {
  it("стрелки переключают вкладки, у выбранной tabindex=0 и aria-selected", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    const first = screen.getByRole("tab", { name: "Первая" });
    const second = screen.getByRole("tab", { name: "Вторая" });
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveAttribute("tabindex", "-1");
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(second).toHaveAttribute("aria-selected", "true");
    expect(second).toHaveFocus();
    await user.keyboard("{Home}");
    expect(first).toHaveAttribute("aria-selected", "true");
  });

  it("панель монтируется при первом открытии и не теряет введённое при возврате", async () => {
    const user = userEvent.setup();
    render(<TabsHarness />);
    expect(screen.queryByText("содержимое второй")).toBeNull();
    await user.type(screen.getByLabelText("поле первой"), "черновик");
    await user.click(screen.getByRole("tab", { name: "Вторая" }));
    expect(screen.getByText("содержимое второй")).toBeVisible();
    expect(screen.getByLabelText("поле первой")).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Первая" }));
    expect(screen.getByLabelText("поле первой")).toHaveValue("черновик");
  });
});

describe("InlineConfirm", () => {
  it("удаление требует второго шага и отменяется", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<InlineConfirm label="Удалить" question="Удалить оценку?" onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Удалить оценку?" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Отмена" }));
    expect(screen.getByRole("button", { name: "Удалить" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Удалить" }));
    await user.click(screen.getByRole("button", { name: "Да, удалить" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("CopyButton", () => {
  it("копирует текст в буфер обмена и подтверждает это", async () => {
    const user = userEvent.setup();
    render(<CopyButton text="compass eval run" />);
    await user.click(screen.getByRole("button", { name: "Копировать" }));
    expect(await screen.findByRole("button", { name: "Скопировано" })).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe("compass eval run");
  });

  it("недоступна, пока копировать нечего", () => {
    render(<CopyButton text="" />);
    expect(screen.getByRole("button", { name: "Копировать" })).toBeDisabled();
  });
});
