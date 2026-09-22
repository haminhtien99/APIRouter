export function pickProxyPoolId() {
  return null;
}

export async function resolveConnectionProxyConfig() {
  return {
    source: "none",
    proxyPoolId: null,
    proxyPool: null,
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    strictProxy: false,
    vercelRelayUrl: "",
  };
}
