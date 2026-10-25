import { describe, expect, it } from "vitest";
import { meta } from "../../test/fixtures";
import { applyTaskType, initialForm, parseForm } from "./workload";

describe("initialForm", () => {
  it("демо-режим начинается с тех же параметров, что и обычный", () => {
    expect(initialForm({ ...meta, demo_mode: true })).toEqual(initialForm(meta));
  });

  it.each([false, true])(
    "по умолчанию: внутренние данные, баланс, без доступа к зарубежным API, токены из типа задачи (demo_mode=%s)",
    (demo) => {
      expect(initialForm({ ...meta, demo_mode: demo })).toMatchObject({
        task_type: "classification",
        data_sensitivity: "internal",
        prefer: "balanced",
        supported_region: false,
        allow_workarounds: false,
        allow_foreign_cloud: true,
        tokens_in: "700",
        tokens_out: "60",
        min_quality: 3,
        deepseek_period: "peak",
      });
    },
  );

  it("форма по умолчанию проходит проверку и уходит на сервер без доступа к зарубежным API", () => {
    const parsed = parseForm(initialForm({ ...meta, demo_mode: true }));
    expect(parsed.errors).toBeNull();
    expect(parsed.workload).toMatchObject({ supported_region: false, data_sensitivity: "internal", prefer: "balanced" });
  });
});

describe("applyTaskType", () => {
  it("подставляет токены и минимальное качество типа задачи", () => {
    const form = applyTaskType(initialForm(meta), "analysis", meta);
    expect(form).toMatchObject({ task_type: "analysis", tokens_in: "3000", tokens_out: "800", min_quality: 4 });
  });
});
