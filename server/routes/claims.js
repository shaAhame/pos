// Supplier warranty claims: send faulty goods back to the supplier and record the outcome.
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi } = require("../lib/util");
const { Joi, validate, id, money, text } = require("../lib/validate");
const { fail } = require("../lib/errors");
const { requireOneLocation, canAccessLocation } = require("../lib/location");
const { nextNumber } = require("../lib/counters");
const { takeStock, moveStock } = require("../lib/stock");
const serialsLib = require("../lib/serials");

const SELECT = `
  select c.*, s.name as supplier_name, s.company as supplier_company, l.name as location_name,
         cb.first_name || ' ' || cb.last_name as created_by_name, rb.first_name || ' ' || rb.last_name as resolved_by_name,
         (select json_agg(json_build_object('_id', i.id, 'product', i.product_id, 'name', i.name, 'quantity', i.quantity,
                 'serial', se.serial, 'fromStock', i.from_stock, 'replacementSerial', i.replacement_serial) order by i.name)
            from supplier_claim_items i left join serials se on se.id = i.serial_id where i.claim_id = c.id) as items
    from supplier_claims c join suppliers s on s.id = c.supplier_id join locations l on l.id = c.location_id
    left join users cb on cb.id = c.created_by left join users rb on rb.id = c.resolved_by`;
const shape = (c) => ({
  ...toApi(c, ["business_id", "items", "supplier_name", "supplier_company", "location_name", "created_by_name", "resolved_by_name"]),
  supplier: { _id: c.supplier_id, name: c.supplier_name, company: c.supplier_company },
  location: { _id: c.location_id, name: c.location_name },
  createdBy: c.created_by_name, resolvedBy: c.resolved_by_name, items: c.items || [],
});
const load = async (db, biz, cid) => (await db.query(`${SELECT} where c.id = $1 and c.business_id = $2`, [cid, biz])).rows[0];

router.get("/", validate(Joi.object({ status: Joi.string().valid("open", "all", "sent", "repaired", "replaced", "credited", "rejected").default("open") }), "query"), async (req, res) => {
  const where = ["c.business_id = $1"], params = [req.biz];
  const st = req.validQuery.status;
  if (st === "open") where.push("c.status = 'sent'");
  else if (st !== "all") { params.push(st); where.push(`c.status = $${params.length}`); }
  const loc = req.user.role === "owner" ? req.location?.id : req.user.locationId;
  if (loc) { params.push(loc); where.push(`c.location_id = $${params.length}`); }
  const { rows } = await query(`${SELECT} where ${where.join(" and ")} order by c.created_at desc limit 300`, params);
  res.json(rows.map(shape));
});

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const c = await load({ query }, req.biz, req.params.id);
  if (!c || !canAccessLocation(req.user, c.location_id)) fail(404, "Claim not found");
  res.json(shape(c));
});

router.post(
  "/",
  validate(Joi.object({
    supplierId: id.required(),
    reason: text(500).min(1).required(),
    note: text(500).allow(""),
    items: Joi.array().min(1).max(200).items(Joi.object({
      product: id.required(),
      quantity: Joi.number().integer().min(1).max(10000).default(1),
      serial: text(64).allow(""),
      fromStock: Joi.boolean().default(true),   // false = an item already off the shelf (e.g. returned faulty by a customer)
    })).required(),
  })),
  async (req, res) => {
    const b = req.body;
    const loc = await requireOneLocation(req);
    const cid = await tx(async (db) => {
      const { rows: [sup] } = await db.query("select id from suppliers where id = $1 and business_id = $2", [b.supplierId, req.biz]);
      if (!sup) fail(400, "Supplier not found");
      const number = await nextNumber(db, req.biz, "claim");
      const { rows: [c] } = await db.query(
        "insert into supplier_claims (business_id, claim_number, supplier_id, location_id, reason, note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id",
        [req.biz, number, sup.id, loc.id, b.reason, b.note || null, req.user.id]
      );
      for (const it of b.items) {
        const { rows: [p] } = await db.query("select * from products where id = $1 and business_id = $2", [it.product, req.biz]);
        if (!p) fail(400, "Product not found");
        const name = p.variant ? `${p.name} ${p.variant}` : p.name;
        let serialId = null;
        if (p.track_serials && req.business.features.serials) {
          if (!it.serial || it.quantity !== 1) fail(400, `Give the serial number of each "${name}" (one line per unit)`);
          const { rows: [u] } = await db.query("select * from serials where business_id = $1 and upper(serial) = upper($2) for update", [req.biz, it.serial.trim()]);
          if (!u || u.product_id !== p.id) fail(400, `Serial ${it.serial} isn't a ${name}`);
          const okStatus = it.fromStock ? (u.status === "in_stock" && u.location_id === loc.id) : (u.status === "defective" && u.location_id === loc.id);
          if (!okStatus) fail(409, `Serial ${u.serial} isn't ${it.fromStock ? "in stock" : "marked faulty"} at this branch (status: ${u.status.replace("_", " ")})`);
          serialId = u.id;
          await serialsLib.setStatus(db, req.biz, u.id, "with_supplier", { event: "sent to supplier", ref: number, note: b.reason, userId: req.user.id });
        }
        if (it.fromStock) await takeStock(db, { biz: req.biz, productId: p.id, locationId: loc.id, quantity: it.quantity, reason: "claim_out", refId: c.id, note: number, userId: req.user.id }, name);
        await db.query(
          "insert into supplier_claim_items (claim_id, product_id, name, quantity, serial_id, from_stock) values ($1,$2,$3,$4,$5,$6)",
          [c.id, p.id, name, it.quantity, serialId, it.fromStock]
        );
      }
      return c.id;
    });
    res.status(201).json(shape(await load({ query }, req.biz, cid)));
  }
);

// Outcome: repaired / replaced -> back on the shelf (replacements get new serials); credited / rejected -> nothing back.
router.post(
  "/:id/resolve",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    outcome: Joi.string().valid("repaired", "replaced", "credited", "rejected").required(),
    creditAmount: money.allow(null),
    note: text(500).allow(""),
    replacementSerials: Joi.object().pattern(id, text(64).min(1)).default({}),   // claim item id -> new serial
  })),
  async (req, res) => {
    const b = req.body;
    await tx(async (db) => {
      const { rows: [c] } = await db.query("select * from supplier_claims where id = $1 and business_id = $2 for update", [req.params.id, req.biz]);
      if (!c || !canAccessLocation(req.user, c.location_id)) fail(404, "Claim not found");
      if (c.status !== "sent") fail(409, "This claim is already resolved");
      const { rows: items } = await db.query("select * from supplier_claim_items where claim_id = $1", [c.id]);
      for (const it of items) {
        const back = b.outcome === "repaired" || b.outcome === "replaced";
        if (back) await moveStock(db, { biz: req.biz, productId: it.product_id, locationId: c.location_id, change: it.quantity, reason: "claim_back", refId: c.id, note: `${c.claim_number} ${b.outcome}`, userId: req.user.id });
        if (!it.serial_id) continue;
        if (b.outcome === "repaired") {
          await serialsLib.setStatus(db, req.biz, it.serial_id, "in_stock", { locationId: c.location_id, event: "back from supplier (repaired)", ref: c.claim_number, userId: req.user.id });
        } else if (b.outcome === "replaced") {
          const newSerial = b.replacementSerials[it.id];
          if (!newSerial) fail(400, `Enter the serial number of the replacement for "${it.name}"`, { code: "SERIALS_REQUIRED", itemId: it.id });
          await serialsLib.setStatus(db, req.biz, it.serial_id, "written_off", { event: "replaced by supplier", ref: c.claim_number, userId: req.user.id });
          await serialsLib.addUnits(db, req.biz, { productId: it.product_id, locationId: c.location_id, serials: [newSerial], event: "replacement from supplier", ref: c.claim_number, userId: req.user.id });
          await db.query("update supplier_claim_items set replacement_serial = $2 where id = $1", [it.id, serialsLib.norm(newSerial)]);
        } else if (b.outcome === "credited") {
          await serialsLib.setStatus(db, req.biz, it.serial_id, "written_off", { event: "supplier gave credit", ref: c.claim_number, userId: req.user.id });
        } else {
          await serialsLib.setStatus(db, req.biz, it.serial_id, "defective", { locationId: c.location_id, event: "claim rejected by supplier", ref: c.claim_number, userId: req.user.id });
        }
      }
      await db.query(
        "update supplier_claims set status = $2, credit_amount = $3, resolution_note = $4, resolved_by = $5, resolved_at = now() where id = $1",
        [c.id, b.outcome, b.outcome === "credited" ? b.creditAmount ?? null : null, b.note || null, req.user.id]
      );
    });
    res.json(shape(await load({ query }, req.biz, req.params.id)));
  }
);

module.exports = router;
