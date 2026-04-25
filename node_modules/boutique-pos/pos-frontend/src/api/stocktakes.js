import { requestJson } from "./http.js";

export function listStocktakeSessions({ signal } = {}) {
  return requestJson("/api/stocktakes", { signal });
}

export function createStocktakeSession(payload) {
  return requestJson("/api/stocktakes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getStocktakeSessionById(id, { signal } = {}) {
  return requestJson(`/api/stocktakes/${id}`, { signal });
}

export function updateStocktakeCounts(id, payload) {
  return requestJson(`/api/stocktakes/${id}/items`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function closeStocktakeSession(id, payload) {
  return requestJson(`/api/stocktakes/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
