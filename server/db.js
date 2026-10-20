require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

// Return NUMERIC (money) and BIGINT values as JavaScript numbers instead of strings.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));

const connectionString = process.env.DATABASE_URL;
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString || "");

const pool = new Pool({
  connectionString,
  ssl: connectionString && !isLocal ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on("error", (err) => console.error("Unexpected database error:", err.message));

const query = (text, params) => pool.query(text, params);

// Run fn(client) inside BEGIN/COMMIT; rolls back on any error.
const tx = async (fn) => {
  const client = await pool.connect();
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

// Create tables if they don't exist yet.
const migrate = async () => {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
};

const connection = async () => {
  if (!connectionString) {
    console.error("DATABASE_URL is not set. Copy server/.env.example to server/.env and fill it in.");
    process.exit(1);
  }
  try {
    await pool.query("select 1");
    await migrate();
    console.log("Connected to database");
  } catch (err) {
    console.error("Database connection error:", err.message);
    process.exit(1);
  }
};

module.exports = { pool, query, tx, migrate, connection };
