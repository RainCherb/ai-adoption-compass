import { useCopy } from "../../hooks/useCopy";
import { Button } from "./Button";

interface CopyButtonProps {
  text: string;
  label?: string;
  disabled?: boolean;
}

export function CopyButton({ text, label = "Копировать", disabled }: CopyButtonProps) {
  const { copied, failed, copy } = useCopy();
  return (
    <>
      <Button size="sm" icon={copied ? "check" : "copy"} disabled={disabled || !text} onClick={() => void copy(text)}>
        {copied ? "Скопировано" : failed ? "Не удалось" : label}
      </Button>
      <span className="visually-hidden" role="status">
        {copied ? "Скопировано в буфер обмена" : failed ? "Не удалось скопировать" : ""}
      </span>
    </>
  );
}
