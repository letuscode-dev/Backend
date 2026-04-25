import { requestJson } from "./http.js";

export function getOpenShift({ signal } = {}) {
  return requestJson("/api/shifts/open", { signal });
}

export function openShift(payload) {
  return requestJson("/api/shifts/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function closeShift(id, payload) {
  return requestJson(`/api/shifts/${id}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function listShifts({ from, to, signal } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return requestJson(qs ? `/api/shifts?${qs}` : "/api/shifts", { signal });
}
