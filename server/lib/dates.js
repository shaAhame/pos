// Build a SQL condition for "column between day `from` and day `to` (inclusive) in the shop's timezone".
// Returns { sql, params } using placeholders starting at $start.
const dayRange = (column, from, to, tz, start = 1) => {
  const parts = [], params = [];
  let i = start;
  if (from) { parts.push(`${column} >= ($${i}::date)::timestamp at time zone $${i + 1}`); params.push(from, tz); i += 2; }
  if (to)   { parts.push(`${column} < ($${i}::date + 1)::timestamp at time zone $${i + 1}`); params.push(to, tz); i += 2; }
  return { sql: parts.join(" and "), params, next: i };
};

module.exports = { dayRange };
