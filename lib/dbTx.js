// Shared MySQL helpers for pooled queries + safe transactions.
// Keep this tiny and dependency-free so controllers stay consistent.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function query(pool, sql, params) {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

function getConnection(pool) {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, conn) => {
      if (err) return reject(err);
      resolve(conn);
    });
  });
}

function queryConn(conn, sql, params) {
  return new Promise((resolve, reject) => {
    conn.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

function beginTransaction(conn) {
  return new Promise((resolve, reject) => {
    conn.beginTransaction((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function commit(conn) {
  return new Promise((resolve, reject) => {
    conn.commit((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function rollback(conn) {
  return new Promise((resolve) => {
    conn.rollback(() => resolve());
  });
}

async function withTransaction(pool, work) {
  const conn = await getConnection(pool);
  try {
    await beginTransaction(conn);
    const result = await work(conn);
    await commit(conn);
    return result;
  } catch (err) {
    try {
      await rollback(conn);
    } catch {
      // ignore
    }
    throw err;
  } finally {
    try {
      conn.release();
    } catch {
      // ignore
    }
  }
}

module.exports = {
  HttpError,
  query,
  queryConn,
  withTransaction,
};

