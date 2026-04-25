import { requestJson } from "./http.js";

export function getStocktakeReport({ from, to, signal } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const qs = params.toString();
  return requestJson(qs ? `/api/reports/stocktake?${qs}` : "/api/reports/stocktake", { signal });
}
