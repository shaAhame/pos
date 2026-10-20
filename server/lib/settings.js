const { query } = require("./db");
const { toApi } = require("./util");

// Settings are read on almost every sale; cache briefly.
let cache = null, cachedAt = 0;
const getSettings = async (db = { query }) => {
  if (cache && Date.now() - cachedAt < 30000 && db.query === query) return cache;
  const { rows } = await db.query("select * from settings where id = 1");
  const s = toApi(rows[0], ["id"]);
  if (db.query === query) { cache = s; cachedAt = Date.now(); }
  return s;
};
const clearSettingsCache = () => { cache = null; };

module.exports = { getSettings, clearSettingsCache };
