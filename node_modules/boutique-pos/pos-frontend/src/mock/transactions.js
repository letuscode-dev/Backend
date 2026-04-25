function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatIsoLocal(date) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `${y}-${m}-${d}T${hh}:${mm}:00`;
}

function seededRandom(seed) {
  // Tiny deterministic PRNG (Mulberry32).
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTOMERS = ["Ava M.", "Noah K.", "Liam D.", "Sophia R.", "Mila T.", "Olivia P.", "Ethan S.", "Zoe N."];

export function getMockTransactions({ days = 14 } = {}) {
  const now = new Date();
  const seed = Number(`${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`);
  const rand = seededRandom(seed);

  const list = [];
  for (let i = 0; i < days * 3; i += 1) {
    const dayOffset = Math.floor(rand() * days);
    const d = new Date(now);
    d.setDate(now.getDate() - dayOffset);
    d.setHours(9 + Math.floor(rand() * 10), Math.floor(rand() * 60), 0, 0);

    const total = Math.round((18 + rand() * 260) * 100) / 100;
    const id = `TX-${String(1000 + i).padStart(4, "0")}`;
    list.push({
      id,
      total,
      customer: rand() > 0.18 ? CUSTOMERS[Math.floor(rand() * CUSTOMERS.length)] : "",
      createdAt: formatIsoLocal(d),
      items: 1 + Math.floor(rand() * 6),
    });
  }

  return list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function sumTransactions(transactions) {
  return transactions.reduce((acc, t) => acc + (Number.isFinite(t.total) ? t.total : 0), 0);
}

export function getDailyRevenueSeries(transactions, days = 7) {
  const now = new Date();
  const buckets = new Map();

  for (let i = 0; i < days; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - (days - 1 - i));
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    buckets.set(key, 0);
  }

  transactions.forEach((t) => {
    const key = String(t.createdAt).slice(0, 10);
    if (!buckets.has(key)) return;
    buckets.set(key, buckets.get(key) + t.total);
  });

  return [...buckets.entries()].map(([date, value]) => ({
    date,
    value: Math.round(value * 100) / 100,
    label: date.slice(5),
  }));
}

