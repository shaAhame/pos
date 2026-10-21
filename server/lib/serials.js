// Serial / IMEI helpers. Every change to a unit is written to serial_events.
const { fail } = require("./errors");

const norm = (s) => String(s || "").trim().toUpperCase();

const logEvent = (db, biz, serialId, event, { locationId = null, ref = null, note = null, userId = null } = {}) =>
  db.query(
    "insert into serial_events (business_id, serial_id, event, location_id, ref_number, note, user_id) values ($1,$2,$3,$4,$5,$6,$7)",
    [biz, serialId, event, locationId, ref, note, userId]
  );

// Lock and return the given serials of a product that are in stock at a location; fails clearly otherwise.
const lockInStock = async (db, biz, productId, locationId, serials, productName) => {
  const wanted = serials.map(norm);
  if (new Set(wanted).size !== wanted.length) fail(400, `The same serial number is listed twice for "${productName}"`);
  const { rows } = await db.query(
    `select * from serials where business_id = $1 and upper(serial) = any($2::text[]) order by id for update`,
    [biz, wanted]
  );
  for (const w of wanted) {
    const r = rows.find((x) => norm(x.serial) === w);
    if (!r) fail(409, `Serial ${w} isn't in the system`, { code: "SERIAL_UNKNOWN", serial: w });
    if (r.product_id !== productId) fail(409, `Serial ${w} belongs to a different product`, { code: "SERIAL_WRONG_PRODUCT", serial: w });
    if (r.status !== "in_stock" || r.location_id !== locationId) {
      fail(409, `Serial ${w} isn't available here (status: ${r.status.replace("_", " ")})`, { code: "SERIAL_UNAVAILABLE", serial: w });
    }
  }
  return wanted.map((w) => rows.find((x) => norm(x.serial) === w));
};

// Add new units to stock (delivery, opening stock, trade-in). Fails if a serial already exists.
const addUnits = async (db, biz, { productId, locationId, serials, cost = null, supplierId = null, event = "received", ref = null, userId = null, note = null }) => {
  const list = serials.map(norm).filter(Boolean);
  if (new Set(list).size !== list.length) fail(400, "The same serial number is listed twice");
  const { rows: existing } = await db.query("select serial from serials where business_id = $1 and upper(serial) = any($2::text[])", [biz, list]);
  if (existing.length) fail(409, `Serial number already in the system: ${existing.map((e) => e.serial).join(", ")}`, { code: "SERIAL_EXISTS" });
  const created = [];
  for (const s of list) {
    const { rows } = await db.query(
      `insert into serials (business_id, product_id, serial, status, location_id, cost, supplier_id)
       values ($1,$2,$3,'in_stock',$4,$5,$6) returning *`,
      [biz, productId, s, locationId, cost, supplierId]
    );
    await logEvent(db, biz, rows[0].id, event, { locationId, ref, userId, note });
    created.push(rows[0]);
  }
  return created;
};

const setStatus = async (db, biz, serialId, status, { locationId = null, event, ref = null, note = null, userId = null, extra = {} }) => {
  const sets = ["status = $3", "location_id = $4", "updated_at = now()"];
  const vals = [serialId, biz, status, locationId];
  for (const [k, v] of Object.entries(extra)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
  await db.query(`update serials set ${sets.join(", ")} where id = $1 and business_id = $2`, vals);
  await logEvent(db, biz, serialId, event, { locationId, ref, note, userId });
};

module.exports = { norm, logEvent, lockInStock, addUnits, setStatus };
