export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    forceStream: true,
    noAuth: true,
    quirks: {
      // Live /zen/v1/models reports capabilities.tools.choice ["auto"] for these.
      forceAutoToolChoiceModels: [
        "muse-spark-1.3-contributor-free",
        "glm-5.3-flash-free",
        "minimax-m3.1-flash-free",
        "mimo-v2.6-flash-free",
      ],
    },
  },
  // Current free catalog from https://opencode.ai/zen/v1/models (verified 2026-11-11).
  // These rotate; modelsFetcher below surfaces new ids as suggested models.
  // Retired ids (muse-spark-*-free, union-alpha) stay routable via passthroughModels
  // and the executor's format sets, but are no longer advertised here.
  models: [
    { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free", contextLength: 200000 },
    { id: "inkling-2-small-free", name: "Inkling 2 Small Free", contextLength: 1048576 },
    { id: "minimax-m3.1-flash-free", name: "MiniMax M3.1 Flash Free", contextLength: 1000000 },
    { id: "glm-5.3-flash-free", name: "GLM 5.3 Flash Free", contextLength: 200000 },
    { id: "mimo-v2.6-flash-free", name: "MiMo V2.6 Flash Free", contextLength: 200000 },
    { id: "big-pickle", name: "Big Pickle", contextLength: 200000 },
    { id: "longcat-2.5-free", name: "LongCat 2.5 Free", contextLength: 1000000 },
    { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL Free", contextLength: 1048576 },
    { id: "beam-free", name: "Beam Free", contextLength: 1048576 },
    { id: "flint-40b-free", name: "Flint 40B Free", contextLength: 262144 },
    { id: "iceman-free", name: "Iceman Free", contextLength: 262144 },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free", contextLength: 262144 },
  ],
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
