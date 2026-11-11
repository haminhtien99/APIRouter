// OpenCode transport adapted from decolua/9router (MIT).
import { OPENCODE_COMPAT_CONFIG } from "../config/opencodeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

class TransportDependencyError extends Error {}

const sessions = new Map();

export async function opencodeTlsFetch(url, options, proxyUrl = "") {
  options.signal?.throwIfAborted();
  // Include credentials in the cache key, but never log the key.
  if (!sessions.has(proxyUrl)) {
    // Only import/dependency-load failures may use native fetch. Session setup
    // and request failures must not silently retry or bypass the selected proxy.
    const pending = import("wreq-js").catch(error => {
      const causes = new Set();
      let dependencyError = error;
      while (dependencyError && !causes.has(dependencyError)) {
        causes.add(dependencyError);
        if (["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(dependencyError.code)) break;
        dependencyError = dependencyError.cause;
      }
      if (["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND"].includes(dependencyError?.code)) {
        throw new TransportDependencyError("Optional wreq-js dependency could not load", { cause: error });
      }
      throw error;
    }).then(async ({ createSession }) => {
      return createSession({
        emulation: { tlsOptions: { cipherList: OPENCODE_COMPAT_CONFIG.cipherList } },
        ...(proxyUrl ? { proxy: proxyUrl } : {}),
      });
    }).catch(error => {
      sessions.delete(proxyUrl);
      throw error;
    });
    if (sessions.size >= OPENCODE_COMPAT_CONFIG.maxTransportSessions) {
      const key = sessions.keys().next().value;
      const old = sessions.get(key);
      sessions.delete(key);
      old.then(session => session.close?.()).catch(() => {});
    }
    sessions.set(proxyUrl, pending);
  }
  let session;
  try {
    session = await sessions.get(proxyUrl);
  } catch (error) {
    options.signal?.throwIfAborted();
    if (!(error instanceof TransportDependencyError)) throw error;
    // This helper owns the saved original fetch, not the patched global fetch.
    // Strict proxy mode forbids fallback to a direct connection on proxy failure.
    return proxyAwareFetch(url, options, { enabled: !!proxyUrl, url: proxyUrl, strictProxy: true });
  }
  options.signal?.throwIfAborted();
  const result = await session.fetch(url, {
    ...options,
    redirect: "follow",
    timeout: OPENCODE_COMPAT_CONFIG.timeoutMs,
  });
  const headers = new Headers();
  result.headers?.forEach((value, key) => headers.set(key, value));
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}
