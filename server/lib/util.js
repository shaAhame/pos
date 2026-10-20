const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

// DB row (snake_case, id) -> API object (camelCase, _id)
const toApi = (row, omit = []) => {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.includes(k)) continue;
    out[k === "id" ? "_id" : camel(k)] = v;
  }
  return out;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v) => typeof v === "string" && UUID_RE.test(v);

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

module.exports = { camel, snake, toApi, isId, round2 };
