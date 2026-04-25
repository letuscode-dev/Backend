import { requestJson } from "./http.js";

export function listProducts({ signal } = {}) {
  return requestJson("/api/products", { signal });
}

export function createProduct(product) {
  return requestJson("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
}

export function updateProduct(id, product) {
  return requestJson(`/api/products/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });
}

export function deleteProduct(id) {
  return requestJson(`/api/products/${id}`, { method: "DELETE" });
}

