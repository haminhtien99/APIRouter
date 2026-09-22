import { describe, it, expect, beforeEach } from "vitest";

import { getRotatedModels, handleComboChat, resetComboRotation } from "../../open-sse/services/combo.js";

describe("combo round-robin routing", () => {
  beforeEach(() => {
    resetComboRotation();
  });

  it("keeps existing one-request round-robin behavior by default", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 4 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin")[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-b",
      "provider/model-a",
      "provider/model-b",
    ]);
  });

  it("sticks to each combo model for the configured number of requests", () => {
    const models = ["provider/model-a", "provider/model-b"];

    const firstChoices = Array.from({ length: 6 }, () => (
      getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]
    ));

    expect(firstChoices).toEqual([
      "provider/model-a",
      "provider/model-a",
      "provider/model-b",
      "provider/model-b",
      "provider/model-a",
      "provider/model-a",
    ]);
  });

  it("tracks sticky rotation independently per combo", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-a");
    expect(getRotatedModels(models, "code-high", "round-robin", 2)[0]).toBe("provider/model-b");
    expect(getRotatedModels(models, "code-xhigh", "round-robin", 2)[0]).toBe("provider/model-a");
  });

  it("does not rotate fallback combos", () => {
    const models = ["provider/model-a", "provider/model-b"];

    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
    expect(getRotatedModels(models, "code-xhigh", "fallback", 2)).toEqual(models);
  });

  it("continues to the next combo model when a ChatGPT account rejects a Codex model", async () => {
    const attempts = [];
    const log = { info: () => {}, warn: () => {} };

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hello" }] },
      models: ["cx/gpt-5.3-codex", "cx/gpt-5.6-sol"],
      comboName: "my_combo",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        if (model === "cx/gpt-5.3-codex") {
          return Response.json({
            error: {
              message: "The 'gpt-5.3-codex' model is not supported when using Codex with a ChatGPT account.",
            },
          }, { status: 400 });
        }
        return Response.json({ ok: true });
      },
    });

    expect(response.ok).toBe(true);
    expect(attempts).toEqual(["cx/gpt-5.3-codex", "cx/gpt-5.6-sol"]);
  });
});
