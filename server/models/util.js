// Helpers for turning database rows (snake_case, "id") into the shape the
// React app expects (camelCase, "_id"), and back.

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

const toApi = (row) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[k === "id" ? "_id" : camel(k)] = v;
  return out;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v) => typeof v === "string" && UUID_RE.test(v);

// Turn common Postgres errors into friendly 400 responses.
const dbError = (res, error, fallback = "Something went wrong") => {
  if (error.code === "23505") {
    const field = (error.constraint || "").replace(/^[a-z]+_/, "").replace(/_key$/, "");
    return res.status(400).json({ error: `${field || "Value"} already exists!`, message: `${field || "Value"} already exists!` });
  }
  if (error.code === "23502") {
    const msg = `${camel(error.column || "field")} is required`;
    return res.status(400).json({ error: msg, message: msg });
  }
  if (["23514", "22P02", "22003"].includes(error.code)) {
    return res.status(400).json({ error: "Invalid value: " + error.message, message: "Invalid value" });
  }
  console.error(error);
  return res.status(500).json({ error: fallback, message: fallback });
};

module.exports = { camel, snake, toApi, isId, dbError };
