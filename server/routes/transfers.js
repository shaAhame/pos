// Stock transfers between branches.
//   Owner sends   -> stock leaves the source branch at once; transfer is "in transit".
//   Destination   -> owner or the destination branch's manager confirms what arrived;
//                    received units are added there, any shortage is recorded.
//   Owner cancels -> (only while in transit) everything goes back to the source branch.
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { Joi, validate, id, text, day } = require("../lib/validate");
const { requireRole } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { getSettings } = require("../lib/settings");
const { dayRange } = require("../lib/dates");
const { moveStock, takeStock, noteMovement } = require("../lib/stock");

const SELECT = `
  select t.*, fl.name as from_name, tl.name as to_name,
         cu.first_name || ' ' || cu.last_name as created_by_name,
         ru.first_name || ' ' || ru.last_name as received_by_name,
         xu.first_name || ' ' || xu.last_name as cancelled_by_name,
         (select json_agg(json_build_object('_id', i.id, 'product', i.product_id, 'name', i.name,
                 'quantitySent', i.quantity_sent, 'quantityReceived', i.quantity_received) order by i.name)
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

const load = async (db, transferId) => (await db.query(`${SELECT} where t.id = $1`, [transferId])).rows[0];

// Owner sees all; a manager sees transfers into or out of their branch.
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
    const { timezone } = await getSettings();
    const where = [], params = [];
    const r = dayRange("t.created_at", q.from, q.to, timezone, 1);
    if (r.sql) { where.push(r.sql); params.push(...r.params); }
    if (q.status !== "all") { params.push(q.status); where.push(`t.status = $${params.length}`); }
    const scopeLoc = req.user.role === "owner" ? req.location?.id : req.user.locationId;
    if (scopeLoc) { params.push(scopeLoc); where.push(`(t.from_location_id = $${params.length} or t.to_location_id = $${params.length})`); }
    const w = where.length ? "where " + where.join(" and ") : "";
    const total = (await query(`select count(*)::int n from transfers t ${w}`, params)).rows[0].n;
    const { rows } = await query(`${SELECT} ${w} order by (t.status = 'in_transit') desc, t.created_at desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`, params);
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, transfers: rows.map(shape) });
  }
);

router.get("/:id", requireRole("manager"), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const t = await load({ query }, req.params.id);
  if (!t || !visible(req.user, t)) fail(404, "Transfer not found");
  res.json(shape(t));
});

// Send stock (owner only).
router.post(
  "/",
  requireRole("owner"),
  validate(Joi.object({
    fromLocationId: id.required(),
    toLocationId: id.required(),
    items: Joi.array().min(1).max(500).items(Joi.object({
      product: id.required(),
      quantity: Joi.number().integer().min(1).max(10000000).required(),
    })).required(),
    note: text(300).allow("").default(""),
  })),
  async (req, res) => {
    const b = req.body;
    if (b.fromLocationId === b.toLocationId) fail(400, "Choose two different branches");
    const merged = new Map();
    for (const it of b.items) merged.set(it.product, (merged.get(it.product) || 0) + it.quantity);

    const transferId = await tx(async (db) => {
      const { rows: locs } = await db.query("select * from locations where id = any($1::uuid[])", [[b.fromLocationId, b.toLocationId]]);
      const from = locs.find((l) => l.id === b.fromLocationId), to = locs.find((l) => l.id === b.toLocationId);
      if (!from || !to) fail(400, "Branch not found");
      if (!from.active || !to.active) fail(400, "Both branches must be active");

      const ids = [...merged.keys()].sort();
      const { rows: prods } = await db.query("select id, name, active from products where id = any($1::uuid[])", [ids]);
      if (prods.length !== ids.length) fail(400, "A product in the list doesn't exist");
      const names = new Map(prods.map((p) => [p.id, p.name]));

      const { rows: [t] } = await db.query(
        `insert into transfers (transfer_number, from_location_id, to_location_id, note, created_by)
         values ('TRF-' || lpad(nextval('transfer_seq')::text, 6, '0'), $1, $2, $3, $4) returning id, transfer_number`,
        [from.id, to.id, b.note || null, req.user.id]
      );
      // Lock source stock rows in a fixed order, then take stock out.
      await db.query(
        "select 1 from product_stock where location_id = $1 and product_id = any($2::uuid[]) order by product_id for update",
        [from.id, ids]
      );
      for (const pid of ids) {
        const qty = merged.get(pid);
        await takeStock(db, { productId: pid, locationId: from.id, quantity: qty, reason: "transfer_out", transferId: t.id,
          note: `${t.transfer_number} to ${to.name}`, userId: req.user.id }, names.get(pid));
        await db.query(
          "insert into transfer_items (transfer_id, product_id, name, quantity_sent) values ($1,$2,$3,$4)",
          [t.id, pid, names.get(pid), qty]
        );
      }
      return t.id;
    });
    res.status(201).json(shape(await load({ query }, transferId)));
  }
);

// Confirm arrival (owner, or a manager of the destination branch).
router.post(
  "/:id/receive",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    items: Joi.array().items(Joi.object({
      itemId: id.required(),
      quantityReceived: Joi.number().integer().min(0).required(),
    })).default([]),           // items not listed are taken as fully received
    note: text(300).allow("").default(""),
  })),
  async (req, res) => {
    const b = req.body;
    await tx(async (db) => {
      const { rows: [t] } = await db.query("select * from transfers where id = $1 for update", [req.params.id]);
      if (!t || !visible(req.user, t)) fail(404, "Transfer not found");
      if (req.user.role !== "owner" && req.user.locationId !== t.to_location_id) fail(403, "Only the receiving branch can confirm this transfer");
      if (t.status !== "in_transit") fail(409, t.status === "received" ? "This transfer was already received" : "This transfer was cancelled");

      const { rows: items } = await db.query("select * from transfer_items where transfer_id = $1 order by product_id", [t.id]);
      const given = new Map(b.items.map((i) => [i.itemId, i.quantityReceived]));
      for (const id of given.keys()) if (!items.some((i) => i.id === id)) fail(400, "Item is not part of this transfer");
      const shortages = [];
      for (const it of items) {
        const got = given.has(it.id) ? given.get(it.id) : it.quantity_sent;
        if (got > it.quantity_sent) fail(400, `More "${it.name}" received than were sent (${it.quantity_sent})`);
        await db.query("update transfer_items set quantity_received = $2 where id = $1", [it.id, got]);
        if (got > 0) {
          await moveStock(db, { productId: it.product_id, locationId: t.to_location_id, change: got, reason: "transfer_in",
            transferId: t.id, note: t.transfer_number, userId: req.user.id });
        }
        if (got < it.quantity_sent) {
          shortages.push(`${it.name}: ${it.quantity_sent - got} missing`);
          await noteMovement(db, { productId: it.product_id, locationId: t.to_location_id, reason: "transfer_short", transferId: t.id,
            userId: req.user.id, note: `${t.transfer_number}: sent ${it.quantity_sent}, received ${got}` });
        }
      }
      const note = [b.note, shortages.length ? `Short: ${shortages.join(", ")}` : ""].filter(Boolean).join(". ");
      await db.query(
        "update transfers set status = 'received', received_by = $2, received_at = now(), receive_note = $3 where id = $1",
        [t.id, req.user.id, note || null]
      );
    });
    res.json(shape(await load({ query }, req.params.id)));
  }
);

// Cancel while in transit (owner only): stock returns to the source branch.
router.post(
  "/:id/cancel",
  requireRole("owner"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ reason: text(300).min(1).required() })),
  async (req, res) => {
    await tx(async (db) => {
      const { rows: [t] } = await db.query("select * from transfers where id = $1 for update", [req.params.id]);
      if (!t) fail(404, "Transfer not found");
      if (t.status !== "in_transit") fail(409, t.status === "received" ? "Already received; it can't be cancelled" : "Already cancelled");
      const { rows: items } = await db.query("select * from transfer_items where transfer_id = $1 order by product_id", [t.id]);
      for (const it of items) {
        await moveStock(db, { productId: it.product_id, locationId: t.from_location_id, change: it.quantity_sent, reason: "transfer_cancel",
          transferId: t.id, note: `${t.transfer_number} cancelled: ${req.body.reason}`, userId: req.user.id });
      }
      await db.query(
        "update transfers set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), receive_note = $3 where id = $1",
        [t.id, req.user.id, req.body.reason]
      );
    });
    res.json(shape(await load({ query }, req.params.id)));
  }
);

module.exports = router;
