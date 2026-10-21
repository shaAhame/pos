// Which branch a request is about.
//  - Cashiers and managers always work in their own branch.
//  - The owner picks one with the X-Location-Id header, or none ("all branches").
const { query } = require("./db");
const { isId } = require("./util");
const { fail } = require("./errors");

const getLocation = async (db, businessId, id) =>
  id ? (await db.query("select * from locations where id = $1 and business_id = $2", [id, businessId])).rows[0] || null : null;

const withLocation = async (req, res, next) => {
  const u = req.user;
  if (u.role !== "owner") {
    req.location = await getLocation({ query }, req.biz, u.locationId);
    if (!req.location) return res.status(403).json({ message: "Your login isn't linked to a branch. Ask the owner." });
    return next();
  }
  const h = req.headers["x-location-id"];
  req.location = isId(h) ? await getLocation({ query }, req.biz, h) : null;
  next();
};

// For actions that happen in one physical place: the chosen branch, or the only branch.
const requireOneLocation = async (req, { storeOnly = false } = {}) => {
  let loc = req.location;
  if (!loc) {
    const { rows } = await query(
      `select * from locations where business_id = $1 and active ${storeOnly ? "and type = 'store'" : ""} order by created_at limit 2`,
      [req.biz]
    );
    if (rows.length === 1) loc = rows[0];
  }
  if (!loc) fail(400, storeOnly ? "Choose a branch (shop) at the top of the screen first" : "Choose a branch at the top of the screen first", { code: "LOCATION_REQUIRED" });
  if (!loc.active) fail(400, `${loc.name} is closed (inactive)`);
  if (storeOnly && loc.type !== "store") fail(400, `${loc.name} is a warehouse; selling happens in shops`);
  return loc;
};

const canAccessLocation = (user, locationId) => user.role === "owner" || user.locationId === locationId;

module.exports = { withLocation, requireOneLocation, getLocation, canAccessLocation };
