import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "../lib/authTokens.js";

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const TOAST_EVENT = "tone:toast";
const AUTH_LOGOUT_EVENT = "tone:auth:logout";
let lastToast = { message: "", at: 0 };

function emitToast({ type = "error", title = "", message = "", timeoutMs } = {}) {
  if (typeof window === "undefined") return;
  const msg = String(message || "").trim();
  if (!msg) return;

  const now = Date.now();
  if (msg === lastToast.message && now - lastToast.at < 1500) return;
  lastToast = { message: msg, at: now };

  try {
    window.dispatchEvent(
      new CustomEvent(TOAST_EVENT, {
        detail: { type: String(type || "error"), title: String(title || ""), message: msg, timeoutMs },
      })
    );
  } catch {
    // ignore
  }
}

function emitAuthLogout({ reason } = {}) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT, { detail: { reason: String(reason || "") } }));
  } catch {
    // ignore
  }
}

function buildUrl(path) {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${p}`;
}

async function readErrorMessage(res) {
  const text = await res.text().catch(() => "");
  if (!text) return `Request failed (${res.status})`;
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && typeof data.error === "string") return data.error;
  } catch {
    // ignore
  }
  return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

let refreshInFlight = null;

function isAbortError(err) {
  if (!err) return false;
  if (err.name === "AbortError") return true;
  const msg = typeof err.message === "string" ? err.message : "";
  return /aborted/i.test(msg) || /abort/i.test(msg);
}

function shouldSkipAutoRefresh(path) {
  const p = String(path || "");
  if (!p.startsWith("/api/auth/")) return false;
  // We *do* want to auto-refresh on /api/auth/me so the app can restore sessions on launch.
  if (p === "/api/auth/me") return false;
  return true;
}

function withAuthHeader(options) {
  const token = getAccessToken();
  const headers = new Headers(options?.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...(options || {}), headers };
}

async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error("Missing refresh token");

  const url = buildUrl("/api/auth/refresh");
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    const original = err?.message ? String(err.message) : String(err || "");
    const msg =
      `Network error calling API. URL: ${url}. ` +
        `On Android builds you must set VITE_API_BASE_URL to a reachable backend URL (not localhost). ` +
        `Original: ${original || "Failed to fetch"}`;
    emitToast({ type: "error", title: "Network Error", message: msg });
    throw new Error(msg);
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    clearTokens();
    emitAuthLogout({ reason: message });

    if (res.status === 401) {
      emitToast({ type: "error", title: "Session Expired", message: "Please log in again." });
    } else {
      emitToast({ type: "error", title: "Auth Error", message });
    }
    throw new Error(message);
  }

  const data = await res.json();
  if (data && typeof data === "object") {
    if (data.accessToken && data.refreshToken) {
      setTokens({ accessToken: String(data.accessToken), refreshToken: String(data.refreshToken) });
    }
  }
  return data;
}

async function ensureFreshTokens() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshAccessToken().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function requestJson(path, options) {
  const url = buildUrl(path);

  const doFetch = async () => {
    let res;
    try {
      res = await fetch(url, withAuthHeader(options));
    } catch (err) {
      if (isAbortError(err)) throw err;
      const original = err?.message ? String(err.message) : String(err || "");
      const msg =
        `Network error calling API. URL: ${url}. ` +
          `On Android builds you must set VITE_API_BASE_URL to a reachable backend URL (not localhost). ` +
          `Original: ${original || "Failed to fetch"}`;
      emitToast({ type: "error", title: "Network Error", message: msg });
      throw new Error(msg);
    }
    return res;
  };

  let res = await doFetch();

  // If access token is expired, rotate refresh token and retry once.
  if (res.status === 401 && !shouldSkipAutoRefresh(path) && getRefreshToken()) {
    try {
      await ensureFreshTokens();
      res = await doFetch();
    } catch {
      // If refresh fails, keep the original 401 response handling below.
    }
  }

  if (!res.ok) {
    const message = await readErrorMessage(res);
    // Avoid noisy toasts on boot: /api/auth/me returns 401 when signed out.
    if (!(path === "/api/auth/me" && res.status === 401 && !getRefreshToken())) {
      emitToast({ type: "error", title: "Request Failed", message });
    }
    throw new Error(message);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const snippet = String(text)
      .slice(0, 120)
      .replace(/\s+/g, " ")
      .trim();
    const looksLikeHtml = snippet.startsWith("<!doctype") || snippet.startsWith("<html") || snippet.startsWith("<");

    const hint = looksLikeHtml
      ? "Received HTML instead of JSON. This usually means your API URL is wrong (Android builds must set VITE_API_BASE_URL to your backend)."
      : "Received a non-JSON response from the API.";

    const msg = `${hint} URL: ${url}. First bytes: "${snippet || "(empty)"}"`;
    emitToast({ type: "error", title: "Bad Response", message: msg });
    throw new Error(msg);
  }
}
