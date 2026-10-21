const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

// NUMERIC (money) and BIGINT come back as JS numbers instead of strings.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE columns (warranty end, due dates) stay as plain "YYYY-MM-DD" text: no timezone shifting.
types.setTypeParser(1082, (v) => v);

let pool;

const createPool = (connectionString = process.env.DATABASE_URL) => {
  const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString || "");
  pool = new Pool({
    connectionString,
    ssl: connectionString && !isLocal ? { rejectUnauthorized: false } : false,
    max: Number(process.env.DB_POOL_SIZE) || 10,
    connectionTimeoutMillis: 10000,
  });
  pool.on("error", (err) => console.error("Database pool error:", err.message));
  return pool;
};

const getPool = () => pool || createPool();
const query = (text, params) => getPool().query(text, params);

// Run fn(client) inside a transaction. Rolls back on any error.
const tx = async (fn) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// Apply migrations/NNN_*.sql in order, each once, each in its own transaction.
const migrate = async () => {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  const client = await getPool().connect();
  try {
    // Serialise concurrent start-ups (e.g. two server instances).
    await client.query("select pg_advisory_lock(727274)");
    await client.query(
      "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
    );
    await client.query("alter table schema_migrations enable row level security");
    const done = new Set((await client.query("select name from schema_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(dir, f), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [f]);
        await client.query("COMMIT");
        console.log(`Applied migration ${f}`);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${f} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(727274)").catch(() => {});
    client.release();
  }
};

const close = async () => { if (pool) { await pool.end(); pool = undefined; } };

module.exports = { createPool, getPool, query, tx, migrate, close };
