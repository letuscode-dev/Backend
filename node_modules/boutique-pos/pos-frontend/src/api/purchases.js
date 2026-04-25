import { requestJson } from "./http.js";

export function listPurchases({ signal } = {}) {
  return requestJson("/api/purchases", { signal });
}

export function getPurchaseById(id, { signal } = {}) {
  return requestJson(`/api/purchases/${id}`, { signal });
}

export function createPurchase(payload) {
  return requestJson("/api/purchases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function replacePurchaseItems(id, payload) {
  return requestJson(`/api/purchases/${id}/items`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function receivePurchase(id, payload) {
  return requestJson(`/api/purchases/${id}/receive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
