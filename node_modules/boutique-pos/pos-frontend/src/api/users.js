import { requestJson } from "./http.js";

export function listUsers({ signal } = {}) {
  return requestJson("/api/users", { signal });
}

export function createUser(user) {
  return requestJson("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
}

export function updateUser(id, user) {
  return requestJson(`/api/users/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
}

export function deleteUser(id) {
  return requestJson(`/api/users/${id}`, { method: "DELETE" });
}

