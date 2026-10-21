const { query } = require("./db");
const { toApi } = require("./util");

// Settings are read on almost every sale; cache briefly per business.
const cache = new Map();
const getSettings = async (businessId, db = { query }) => {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < 30000 && db.query === query) return hit.value;
  const { rows } = await db.query("select * from settings where business_id = $1", [businessId]);
  const s = toApi(rows[0], ["business_id"]);
  if (db.query === query) cache.set(businessId, { value: s, at: Date.now() });
  return s;
};
const clearSettingsCache = (businessId) => (businessId ? cache.delete(businessId) : cache.clear());

module.exports = { getSettings, clearSettingsCache };
