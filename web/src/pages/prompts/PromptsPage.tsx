import { useState } from "react";
import { PageHeader } from "../../components/ui/PageHeader";
import { TabPanel, Tabs, useTabs } from "../../components/ui/Tabs";
import { LintTab } from "./LintTab";
import { ScaffoldTab } from "./ScaffoldTab";
import { TemplatesTab } from "./TemplatesTab";

type PromptsTab = "templates" | "lint" | "scaffold";

export function PromptsPage() {
  const tabs = useTabs<PromptsTab>("templates");
  // Каркас передаёт текст линтеру: ключ заставляет вкладку перемонтироваться с новым текстом и сразу проверить его.
  const [handoff, setHandoff] = useState<{ text: string; nonce: number }>({ text: "", nonce: 0 });

  const sendToLint = (text: string) => {
    setHandoff((previous) => ({ text, nonce: previous.nonce + 1 }));
    tabs.select("lint");
  };

  return (
    <>
      <PageHeader
        title="Промпты"
        lead="Готовые шаблоны для отделов, проверка качества запроса и каркас для новых задач. Все тексты остаются на вашем сервере."
      />
      <Tabs
        tabs={tabs}
        prefix="prompts"
        label="Разделы библиотеки промптов"
        items={[
          { id: "templates", label: "Шаблоны" },
          { id: "lint", label: "Проверка запроса" },
          { id: "scaffold", label: "Каркас запроса" },
        ]}
      />
      <TabPanel tabs={tabs} id="templates" prefix="prompts">
        <TemplatesTab />
      </TabPanel>
      <TabPanel tabs={tabs} id="lint" prefix="prompts">
        <LintTab key={handoff.nonce} initialText={handoff.text} autorun={handoff.nonce > 0} />
      </TabPanel>
      <TabPanel tabs={tabs} id="scaffold" prefix="prompts">
        <ScaffoldTab onLint={sendToLint} />
      </TabPanel>
    </>
  );
}
