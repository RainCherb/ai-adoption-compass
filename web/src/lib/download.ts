/** Сохраняет текст как файл без обращения к серверу (Blob + временная ссылка). */
export function downloadTextFile(filename: string, content: string, mime = "text/markdown;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
