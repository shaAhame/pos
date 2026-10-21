// Stock transfers between branches (owner sends; receiving branch confirms; owner may cancel in transit).
// Serial-tracked products move as specific units.
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { Joi, validate, id, text, day } = require("../lib/validate");
const { requireRole } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { getSettings } = require("../lib/settings");
const { dayRange } = require("../lib/dates");
const { moveStock, takeStock, noteMovement } = require("../lib/stock");
const { nextNumber } = require("../lib/counters");
const serialsLib = require("../lib/serials");

const SELECT = `
  select t.*, fl.name as from_name, tl.name as to_name,
         cu.first_name || ' ' || cu.last_name as created_by_name,
         ru.first_name || ' ' || ru.last_name as received_by_name,
         xu.first_name || ' ' || xu.last_name as cancelled_by_name,
         (select json_agg(json_build_object('_id', i.id, 'product', i.product_id, 'name', i.name,
                 'quantitySent', i.quantity_sent, 'quantityReceived', i.quantity_received,
                 'serials', (select coalesce(json_agg(json_build_object('serial', s.serial, 'received', tis.received) order by s.serial), '[]'::json)
                               from transfer_item_serials tis join serials s on s.id = tis.serial_id where tis.transfer_item_id = i.id)) order by i.name)
            from transfer_items i where i.transfer_id = t.id) as items
    from transfers t
    join locations fl on fl.id = t.from_location_id
    join locations tl on tl.id = t.to_location_id
    left join users cu on cu.id = t.created_by
    left join users ru on ru.id = t.received_by
    left join users xu on xu.id = t.cancelled_by`;

const shape = (t) => ({
  _id: t.id,
  transferNumber: t.transfer_number,
  from: { _id: t.from_location_id, name: t.from_name },
  to: { _id: t.to_location_id, name: t.to_name },
  status: t.status,
  note: t.note,
  items: t.items || [],
  totalSent: (t.items || []).reduce((s, i) => s + i.quantitySent, 0),
  totalReceived: t.status === "received" ? (t.items || []).reduce((s, i) => s + (i.quantityReceived || 0), 0) : null,
  createdAt: t.created_at, createdBy: t.created_by_name,
  receivedAt: t.received_at, receivedBy: t.received_by_name, receiveNote: t.receive_note,
  cancelledAt: t.cancelled_at, cancelledBy: t.cancelled_by_name,
});

const load = async (db, biz, transferId) => (await db.query(`${SELECT} where t.id = $1 and t.business_id = $2`, [transferId, biz])).rows[0];
const visible = (user, t) => user.role === "owner" || [t.from_location_id, t.to_location_id].includes(user.locationId);

router.get(
  "/",
  requireRole("manager"),
  validate(Joi.object({
    status: Joi.string().valid("all", "in_transit", "received", "cancelled").default("all"),
    from: day, to: day,
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(25),
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const { timezone } = await getSettings(req.biz);
    const where = ["t.business_id = $1"], params = [req.biz];
    const r = dayRange("t.created_at", q.from, q.to, timezone, 2);
    if (r.sql) { where.push(r.sql); params.push(...r.params); }
    if (q.status !== "all") { params.push(q.status); where.push(`t.status = $${params.length}`); }
    const scopeLoc = req.user.role === "owner" ? req.location?.id : req.user.locationId;
    if (scopeLoc) { params.push(scopeLoc); where.push(`(t.from_location_id = $${params.length} or t.to_location_id = $${params.length})`); }
    const w = "where " + where.join(" and ");
    const total = (await query(`select count(*)::int n from transfers t ${w}`, params)).rows[0].n;
    const { rows } = await query(`${SELECT} ${w} order by (t.status = 'in_transit') desc, t.created_at desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`, params);
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, transfers: rows.map(shape) });
  }
);

router.get("/:id", requireRole("manager"), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const t = await load({ query }, req.biz, req.params.id);
  if (!t || !visible(req.user, t)) fail(404, "Transfer not found");
  res.json(shape(t));
});

router.post(
  "/",
  requireRole("owner"),
  validate(Joi.object({
    fromLocationId: id.required(),
    toLocationId: id.required(),
    items: Joi.array().min(1).max(500).items(Joi.object({
      product: id.required(),
      quantity: Joi.number().integer().min(1).max(10000000).required(),
      serials: Joi.array().items(text(64).min(1)).max(10000).default([]),
    })).required(),
    note: text(300).allow("").default(""),
  })),
  async (req, res) => {
    const b = req.body;
    const biz = req.biz;
    if (b.fromLocationId === b.toLocationId) fail(400, "Choose two different branches");
    const merged = new Map();
    for (const it of b.items) {
      const cur = merged.get(it.product);
      merged.set(it.product, cur ? { quantity: cur.quantity + it.quantity, serials: [...cur.serials, ...it.serials] } : { quantity: it.quantity, serials: [...it.serials] });
    }
    const transferId = await tx(async (db) => {
      const { rows: locs } = await db.query("select * from locations where id = any($1::uuid[]) and business_id = $2", [[b.fromLocationId, b.toLocationId], biz]);
      const from = locs.find((l) => l.id === b.fromLocationId), to = locs.find((l) => l.id === b.toLocationId);
      if (!from || !to) fail(400, "Branch not found");
      if (!from.active || !to.active) fail(400, "Both branches must be active");

      const ids = [...merged.keys()].sort();
      const { rows: prods } = await db.query("select id, name, variant, track_serials from products where id = any($1::uuid[]) and business_id = $2", [ids, biz]);
      if (prods.length !== ids.length) fail(400, "A product in the list doesn't exist");
      const pmap = new Map(prods.map((p) => [p.id, p]));

      const number = await nextNumber(db, biz, "transfer");
      const { rows: [t] } = await db.query(
        `insert into transfers (business_id, transfer_number, from_location_id, to_location_id, note, created_by)
         values ($1,$2,$3,$4,$5,$6) returning id`,
        [biz, number, from.id, to.id, b.note || null, req.user.id]
      );
      await db.query("select 1 from product_stock where location_id = $1 and product_id = any($2::uuid[]) order by product_id for update", [from.id, ids]);
      for (const pid of ids) {
        const p = pmap.get(pid);
        const name = p.variant ? `${p.name} ${p.variant}` : p.name;
        const { quantity, serials } = merged.get(pid);
        const tracked = p.track_serials && req.business.features.serials;
        if (tracked && serials.length !== quantity) fail(400, `Scan the serial number of each "${name}" being sent (${serials.length} of ${quantity})`, { code: "SERIALS_REQUIRED" });
        const units = tracked ? await serialsLib.lockInStock(db, biz, pid, from.id, serials, name) : [];
        await takeStock(db, { biz, productId: pid, locationId: from.id, quantity, reason: "transfer_out", transferId: t.id, note: `${number} to ${to.name}`, userId: req.user.id }, name);
        const { rows: [ti] } = await db.query(
          "insert into transfer_items (transfer_id, product_id, name, quantity_sent) values ($1,$2,$3,$4) returning id",
          [t.id, pid, name, quantity]
        );
        for (const u of units) {
          await serialsLib.setStatus(db, biz, u.id, "in_transit", { event: `sent to ${to.name}`, ref: number, userId: req.user.id });
          await db.query("insert into transfer_item_serials (transfer_item_id, serial_id) values ($1,$2)", [ti.id, u.id]);
        }
      }
      return t.id;
    });
    res.status(201).json(shape(await load({ query }, biz, transferId)));
  }
);

router.post(
  "/:id/receive",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    items: Joi.array().items(Joi.object({
      itemId: id.required(),
      quantityReceived: Joi.number().integer().min(0),
      missingSerials: Joi.array().items(text(64)).default([]),   // for serial-tracked items: which units didn't arrive
    })).default([]),
    note: text(300).allow("").default(""),
  })),
  async (req, res) => {
    const b = req.body;
    const biz = req.biz;
    await tx(async (db) => {
      const { rows: [t] } = await db.query("select * from transfers where id = $1 and business_id = $2 for update", [req.params.id, biz]);
      if (!t || !visible(req.user, t)) fail(404, "Transfer not found");
      if (req.user.role !== "owner" && req.user.locationId !== t.to_location_id) fail(403, "Only the receiving branch can confirm this transfer");
      if (t.status !== "in_transit") fail(409, t.status === "received" ? "This transfer was already received" : "This transfer was cancelled");

      const { rows: items } = await db.query("select * from transfer_items where transfer_id = $1 order by product_id", [t.id]);
      const given = new Map(b.items.map((i) => [i.itemId, i]));
      for (const k of given.keys()) if (!items.some((i) => i.id === k)) fail(400, "Item is not part of this transfer");
      const shortages = [];
      for (const it of items) {
        const g = given.get(it.id) || {};
        const { rows: units } = await db.query(
          "select tis.serial_id, s.serial from transfer_item_serials tis join serials s on s.id = tis.serial_id where tis.transfer_item_id = $1", [it.id]);
        let got;
        if (units.length) {
          const missing = new Set((g.missingSerials || []).map(serialsLib.norm));
          for (const m of missing) if (!units.some((u) => serialsLib.norm(u.serial) === m)) fail(400, `Serial ${m} isn't part of this transfer`);
          got = units.length - missing.size;
          for (const u of units) {
            const arrived = !missing.has(serialsLib.norm(u.serial));
            await db.query("update transfer_item_serials set received = $3 where transfer_item_id = $1 and serial_id = $2", [it.id, u.serial_id, arrived]);
            await serialsLib.setStatus(db, biz, u.serial_id, arrived ? "in_stock" : "missing", {
              locationId: arrived ? t.to_location_id : null, event: arrived ? "received by branch" : "missing from transfer", ref: t.transfer_number, userId: req.user.id });
          }
        } else {
          got = g.quantityReceived === undefined ? it.quantity_sent : g.quantityReceived;
          if (got > it.quantity_sent) fail(400, `More "${it.name}" received than were sent (${it.quantity_sent})`);
        }
        await db.query("update transfer_items set quantity_received = $2 where id = $1", [it.id, got]);
        if (got > 0) await moveStock(db, { biz, productId: it.product_id, locationId: t.to_location_id, change: got, reason: "transfer_in", transferId: t.id, note: t.transfer_number, userId: req.user.id });
        if (got < it.quantity_sent) {
          shortages.push(`${it.name}: ${it.quantity_sent - got} missing`);
          await noteMovement(db, { biz, productId: it.product_id, locationId: t.to_location_id, reason: "transfer_short", transferId: t.id, userId: req.user.id,
            note: `${t.transfer_number}: sent ${it.quantity_sent}, received ${got}` });
        }
      }
      const note = [b.note, shortages.length ? `Short: ${shortages.join(", ")}` : ""].filter(Boolean).join(". ");
      await db.query("update transfers set status = 'received', received_by = $2, received_at = now(), receive_note = $3 where id = $1", [t.id, req.user.id, note || null]);
    });
    res.json(shape(await load({ query }, biz, req.params.id)));
  }
);

router.post(
  "/:id/cancel",
  requireRole("owner"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ reason: text(300).min(1).required() })),
  async (req, res) => {
    const biz = req.biz;
    await tx(async (db) => {
      const { rows: [t] } = await db.query("select * from transfers where id = $1 and business_id = $2 for update", [req.params.id, biz]);
      if (!t) fail(404, "Transfer not found");
      if (t.status !== "in_transit") fail(409, t.status === "received" ? "Already received; it can't be cancelled" : "Already cancelled");
      const { rows: items } = await db.query("select * from transfer_items where transfer_id = $1 order by product_id", [t.id]);
      for (const it of items) {
        await moveStock(db, { biz, productId: it.product_id, locationId: t.from_location_id, change: it.quantity_sent, reason: "transfer_cancel",
          transferId: t.id, note: `${t.transfer_number} cancelled: ${req.body.reason}`, userId: req.user.id });
        const { rows: units } = await db.query("select serial_id from transfer_item_serials where transfer_item_id = $1", [it.id]);
        for (const u of units) await serialsLib.setStatus(db, biz, u.serial_id, "in_stock", { locationId: t.from_location_id, event: "transfer cancelled", ref: t.transfer_number, userId: req.user.id });
      }
      await db.query("update transfers set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), receive_note = $3 where id = $1", [t.id, req.user.id, req.body.reason]);
    });
    res.json(shape(await load({ query }, biz, req.params.id)));
  }
);

module.exports = router;
