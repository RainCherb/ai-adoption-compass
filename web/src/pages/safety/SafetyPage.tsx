import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { TabPanel, Tabs, useTabs } from "../../components/ui/Tabs";
import { AnalyzeTab } from "./AnalyzeTab";
import { PolicyTab } from "./PolicyTab";

type SafetyTab = "analyze" | "policy";

export function SafetyPage() {
  const tabs = useTabs<SafetyTab>("analyze");
  return (
    <>
      <PageHeader
        title="Безопасность данных"
        lead="Проверьте текст перед отправкой в нейросеть: сервис найдёт персональные данные и секреты, подскажет допустимый контур и обезличит текст."
      />
      <p className="privacy-note">
        <Icon name="lock" size={16} />
        Текст обрабатывается локально и нигде не хранится. В журнале остаются только метаданные: число символов, типы находок и решения.
      </p>
      <Tabs
        tabs={tabs}
        prefix="safety"
        label="Разделы безопасности данных"
        items={[
          { id: "analyze", label: "Проверка текста" },
          { id: "policy", label: "Политика" },
        ]}
      />
      <TabPanel tabs={tabs} id="analyze" prefix="safety">
        <AnalyzeTab />
      </TabPanel>
      <TabPanel tabs={tabs} id="policy" prefix="safety">
        <PolicyTab />
      </TabPanel>
    </>
  );
}
