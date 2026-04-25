const { createClient } = require("redis");

let client = null;
let connecting = null;
let lastConnectErrorAt = 0;

function getRedisUrl() {
  const url = String(process.env.REDIS_URL || "").trim();
  return url || null;
}

async function getRedisClient() {
  const url = getRedisUrl();
  if (!url) return null;

  if (client && client.isOpen) return client;
  if (connecting) return connecting;

  client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => {
        // Backoff to ~2s max.
        const ms = Math.min(2000, 50 * Math.max(1, retries));
        return ms;
      },
    },
  });

  client.on("error", (err) => {
    const now = Date.now();
    // Avoid flooding logs if Redis is down.
    if (now - lastConnectErrorAt > 5000) {
      lastConnectErrorAt = now;
      console.error("Redis error:", err?.message || err);
    }
  });

  connecting = client
    .connect()
    .then(() => {
      connecting = null;
      return client;
    })
    .catch((err) => {
      connecting = null;
      try {
        client.quit();
      } catch {
        // ignore
      }
      client = null;
      throw err;
    });

  return connecting;
}

module.exports = { getRedisClient };

