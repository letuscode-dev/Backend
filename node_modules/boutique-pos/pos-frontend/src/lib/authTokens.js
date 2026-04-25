const ACCESS_TOKEN_KEY = "tone_access_token";
const REFRESH_TOKEN_KEY = "tone_refresh_token";

export function getAccessToken() {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function getRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setTokens({ accessToken, refreshToken }) {
  try {
    if (typeof accessToken === "string" && accessToken) localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
    if (typeof refreshToken === "string" && refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch {
    // ignore
  }
}

export function clearTokens() {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

