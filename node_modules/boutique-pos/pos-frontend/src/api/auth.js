import { requestJson } from "./http.js";

export function login({ username, password }) {
  return requestJson("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
}

export function refresh({ refreshToken }) {
  return requestJson("/api/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
}

export function logout({ refreshToken }) {
  return requestJson("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
}

export function bootstrap({ name, username, password }) {
  return requestJson("/api/auth/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, username, password }),
  });
}

export function bootstrapStatus({ signal } = {}) {
  return requestJson("/api/auth/bootstrap/status", { signal });
}

export function me({ signal } = {}) {
  return requestJson("/api/auth/me", { signal });
}
