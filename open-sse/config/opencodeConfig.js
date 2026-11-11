// OpenCode v2 compatibility, based on decolua/9router (MIT).
export const OPENCODE_COMPAT_CONFIG = {
  userAgent: "opencode/latest/2.0.26/cli",
  client: "cli",
  apiPath: "/inference/v1",
  // Live A/B: this declaration name returns 429 even with an empty schema.
  // Preserve the full tool and restore its original name on responses.
  toolAliases: { subagent_fork: "delegate_context" },
  maxTransportSessions: 8,
  maxTranslatedSessions: 5000,
  timeoutMs: 120000,
  cipherList: [
    "TLS_AES_128_GCM_SHA256", "TLS_AES_256_GCM_SHA384", "TLS_CHACHA20_POLY1305_SHA256",
    "ECDHE-ECDSA-AES128-GCM-SHA256", "ECDHE-RSA-AES128-GCM-SHA256",
    "ECDHE-ECDSA-AES256-GCM-SHA384", "ECDHE-RSA-AES256-GCM-SHA384",
    "ECDHE-ECDSA-CHACHA20-POLY1305", "ECDHE-RSA-CHACHA20-POLY1305",
    "ECDHE-ECDSA-AES128-SHA", "ECDHE-RSA-AES128-SHA", "ECDHE-ECDSA-AES256-SHA",
    "ECDHE-RSA-AES256-SHA", "AES128-GCM-SHA256", "AES256-GCM-SHA384", "AES128-SHA", "AES256-SHA",
  ].join(":"),
};
