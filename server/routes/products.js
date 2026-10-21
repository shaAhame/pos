const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi, snake } = require("../lib/util");
const { Joi, validate, id, money, text } = require("../lib/validate");
const { requireRole, atLeast } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { likeParam } = require("../lib/crud");
const { requireOneLocation, canAccessLocation, getLocation } = require("../lib/location");
const { moveStock } = require("../lib/stock");
const serialsLib = require("../lib/serials");

const shape = (row, user) => {
  const out = toApi(row, ["business_id", ...(atLeast(user, "manager") ? [] : ["cost_price"])]);
  if (row.stock_by_location) out.stockByLocation = row.stock_by_location;
  out.displayName = row.variant ? `${row.name} ${row.variant}` : row.name;
  return out;
};

const stockLocation = (req, qLoc) => {
  if (qLoc) {
    if (!canAccessLocation(req.user, qLoc)) fail(403, "You can only see your own branch");
    return qLoc;
  }
  return req.location?.id || null;
};

// SELECT products of one business with quantity for one location (or total over active locations).
// $1 = business, $2 = location (nullable)
const productSelect = (withStock) => `
  select p.*, q.quantity
         ${withStock ? `, (select json_agg(json_build_object('locationId', l.id, 'name', l.name, 'type', l.type, 'quantity', coalesce(ps.quantity, 0)) order by l.type desc, l.created_at)
                            from locations l left join product_stock ps on ps.location_id = l.id and ps.product_id = p.id
                           where l.active and l.business_id = $1) as stock_by_location` : ""}
    from products p
    cross join lateral (
      select coalesce(sum(ps.quantity), 0)::int as quantity
        from product_stock ps join locations l on l.id = ps.location_id
       where ps.product_id = p.id and (($2::uuid is null and l.active) or ps.location_id = $2::uuid)
    ) q
   where p.business_id = $1`;

const barcode = text(64).allow("", null).empty(["", null]);
const fields = {
  name: text(120), description: text(500).allow(""), category: text(60),
  price: money, barcode, lowStockThreshold: Joi.number().integer().min(0).max(100000),
  model: text(120).allow(""), variant: text(80).allow(""),
  warrantyMonths: Joi.number().integer().min(0).max(240), trackSerials: Joi.boolean(),
};
const serialList = Joi.array().items(text(64).min(1)).max(10000);

router.get(
  "/",
  validate(Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(5000).default(20),
    sortBy: Joi.string().valid("name", "price", "quantity", "category", "createdAt").default("name"),
    order: Joi.string().valid("asc", "desc").default("asc"),
    filter: Joi.string().trim().allow("").max(100).default(""),
    category: Joi.string().trim().allow("").max(60).default(""),
    status: Joi.string().valid("active", "archived", "all").default("active"),
    lowStock: Joi.boolean().default(false),
    locationId: id,
    withStock: Joi.boolean().default(false),
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const loc = stockLocation(req, q.locationId);
    const params = [req.biz, loc];
    const where = [];
    const p = (v) => { params.push(v); return "$" + params.length; };
    if (q.status !== "all") where.push(`p.active = ${q.status === "active"}`);
    if (q.filter) {
      const f = p(likeParam(q.filter));
      where.push(`(p.name ilike ${f} or p.description ilike ${f} or p.barcode ilike ${f} or p.category ilike ${f} or p.model ilike ${f} or p.variant ilike ${f})`);
    }
    if (q.category) where.push(`p.category = ${p(q.category)}`);
    if (q.lowStock) where.push("q.quantity <= p.low_stock_threshold");
    const w = where.length ? " and " + where.join(" and ") : "";
    const base = productSelect(q.withStock && atLeast(req.user, "manager"));
    const total = (await query(`select count(*)::int n from (${base} ${w}) x`, params)).rows[0].n;
    const sortCol = q.sortBy === "quantity" ? "q.quantity" : "p." + snake(q.sortBy);
    const { rows } = await query(`${base} ${w} order by ${sortCol} ${q.order}, p.name, p.variant, p.id limit ${q.limit} offset ${(q.page - 1) * q.limit}`, params);
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, locationId: loc, products: rows.map((r) => shape(r, req.user)) });
  }
);

router.get("/categories", async (req, res) => {
  const { rows } = await query("select distinct category from products where active and business_id = $1 order by category", [req.biz]);
  res.json(rows.map((r) => r.category));
});

// Barcode (or serial number) lookup for the till scanner.
router.get("/barcode/:code", validate(Joi.object({ locationId: id }), "query"), async (req, res) => {
  const loc = stockLocation(req, req.validQuery.locationId);
  const code = String(req.params.code).trim();
  const { rows } = await query(`${productSelect(false)} and p.barcode = $3 and p.active`, [req.biz, loc, code]);
  if (rows[0]) return res.json(shape(rows[0], req.user));
  // scanning an IMEI/serial at the till finds its product too
  const { rows: s } = await query(
    `select s.serial, s.status, s.location_id, p.id from serials s join products p on p.id = s.product_id
      where s.business_id = $1 and upper(s.serial) = upper($2) and p.active`,
    [req.biz, code]
  );
  if (s[0]) {
    const { rows: pr } = await query(`${productSelect(false)} and p.id = $3`, [req.biz, loc, s[0].id]);
    return res.json({ ...shape(pr[0], req.user), scannedSerial: { serial: s[0].serial, status: s[0].status, here: s[0].location_id === loc } });
  }
  fail(404, "No product with that barcode or serial number");
});

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query(`${productSelect(atLeast(req.user, "manager"))} and p.id = $3`, [req.biz, req.location?.id || null, req.params.id]);
  if (!rows[0]) fail(404, "Product not found");
  res.json(shape(rows[0], req.user));
});

// Units of a serial-tracked product (in stock at a branch by default).
router.get(
  "/:id/serials",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ status: Joi.string().valid("in_stock", "all").default("in_stock"), locationId: id }), "query"),
  async (req, res) => {
    const loc = stockLocation(req, req.validQuery.locationId);
    const { rows } = await query(
      `select s.id as _id, s.serial, s.status, s.location_id, l.name as location_name, s.warranty_until, s.received_at, s.sold_at
         from serials s left join locations l on l.id = s.location_id
        where s.business_id = $1 and s.product_id = $2 and ($3::uuid is null or s.location_id = $3::uuid)
          and ($4 = 'all' or s.status = 'in_stock')
        order by s.status, s.serial limit 2000`,
      [req.biz, req.params.id, loc, req.validQuery.status]
    );
    res.json(rows.map((r) => toApi(r)));
  }
);

// Products and prices are shared by all branches, so only the owner adds or edits them.
router.post(
  "/",
  requireRole("owner"),
  validate(Joi.object({
    ...fields,
    name: fields.name.required(), category: fields.category.required(), price: fields.price.required(),
    description: fields.description.default(""), lowStockThreshold: fields.lowStockThreshold.default(5),
    barcode: barcode.default(null), costPrice: money.allow(null, "").empty("").default(null),
    model: fields.model.default(""), variant: fields.variant.default(""),
    warrantyMonths: fields.warrantyMonths.default(0), trackSerials: fields.trackSerials.default(false),
    quantity: Joi.number().integer().min(0).max(10000000).default(0),
    serials: serialList.default([]),
    locationId: id,
  })),
  async (req, res) => {
    const b = req.body;
    const f = req.business.features;
    if (b.trackSerials && !f.serials) fail(400, "Serial numbers aren't switched on for this business");
    if (b.warrantyMonths && !f.warranty) b.warrantyMonths = 0;
    if ((b.model || b.variant) && !f.variants) { b.model = ""; b.variant = ""; }
    if (b.trackSerials && b.serials.length !== b.quantity) fail(400, `Enter one serial number per unit (${b.serials.length} entered, opening stock ${b.quantity})`);
    let openingLoc = null;
    if (b.quantity > 0) {
      openingLoc = b.locationId ? await getLocation({ query }, req.biz, b.locationId) : await requireOneLocation(req);
      if (!openingLoc) fail(400, "Branch not found");
    }
    const product = await tx(async (db) => {
      const { rows } = await db.query(
        `insert into products (business_id, name, description, category, price, cost_price, barcode, low_stock_threshold, model, variant, warranty_months, track_serials)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [req.biz, b.name, b.description, b.category, b.price, b.costPrice, b.barcode, b.lowStockThreshold, b.model, b.variant, b.warrantyMonths, b.trackSerials]
      );
      await db.query(
        "insert into product_stock (business_id, product_id, location_id, quantity) select $2, $1, id, 0 from locations where business_id = $2 on conflict do nothing",
        [rows[0].id, req.biz]
      );
      if (b.quantity > 0) {
        await moveStock(db, { biz: req.biz, productId: rows[0].id, locationId: openingLoc.id, change: b.quantity, reason: "initial", unitCost: b.costPrice, note: "Opening stock", userId: req.user.id });
        if (b.trackSerials) await serialsLib.addUnits(db, req.biz, { productId: rows[0].id, locationId: openingLoc.id, serials: b.serials, cost: b.costPrice, event: "opening stock", userId: req.user.id });
      }
      return rows[0];
    });
    const { rows } = await query(`${productSelect(true)} and p.id = $3`, [req.biz, openingLoc?.id || req.location?.id || null, product.id]);
    res.status(201).json(shape(rows[0], req.user));
  }
);

router.put(
  "/:id",
  requireRole("owner"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ ...fields, barcode: text(64).allow("", null), costPrice: money.allow(null, ""), active: Joi.boolean() }).min(1)),
  async (req, res) => {
    const b = { ...req.body };
    if (b.costPrice === "") b.costPrice = null;
    if (b.barcode === "") b.barcode = null;
    if (b.trackSerials) {
      if (!req.business.features.serials) fail(400, "Serial numbers aren't switched on for this business");
      const { rows: [c] } = await query(
        `select p.track_serials, (select coalesce(sum(quantity),0)::int from product_stock where product_id = p.id) as qty
           from products p where p.id = $1 and p.business_id = $2`, [req.params.id, req.biz]);
      if (c && !c.track_serials && c.qty > 0) fail(400, "To start tracking serial numbers, first bring this product's stock to 0 with a stock count, then receive the units with their serial numbers");
    }
    const keys = Object.keys(b);
    const { rows } = await query(
      `update products set ${keys.map((k, i) => `${snake(k)} = $${i + 3}`).join(", ")} where id = $1 and business_id = $2 returning id`,
      [req.params.id, req.biz, ...keys.map((k) => b[k])]
    );
    if (!rows[0]) fail(404, "Product not found");
    const { rows: full } = await query(`${productSelect(true)} and p.id = $3`, [req.biz, req.location?.id || null, req.params.id]);
    res.json(shape(full[0], req.user));
  }
);

router.delete("/:id", requireRole("owner"), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query("update products set active = false where id = $1 and business_id = $2 returning id", [req.params.id, req.biz]);
  if (!rows[0]) fail(404, "Product not found");
  res.json({ message: "Product archived" });
});

// Receive a delivery, or correct the count after a stock-take, at one branch.
// Serial-tracked products list the units: receive -> serials; adjust -> addSerials / removeSerials.
router.post(
  "/:id/stock",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    type: Joi.string().valid("receive", "adjust").required(),
    quantity: Joi.number().integer().min(0).max(10000000),
    serials: serialList, addSerials: serialList, removeSerials: serialList,
    locationId: id,
    supplierId: id.allow(null, "").empty(["", null]).default(null),
    unitCost: money.allow(null, "").empty(["", null]).default(null),
    note: Joi.when("type", { is: "adjust", then: text(300).min(1).required(), otherwise: text(300).allow("").default("") }),
  })),
  async (req, res) => {
    const b = req.body;
    let loc;
    if (b.locationId) {
      if (!canAccessLocation(req.user, b.locationId)) fail(403, "You can only change stock in your own branch");
      loc = await getLocation({ query }, req.biz, b.locationId);
      if (!loc) fail(404, "Branch not found");
    } else loc = await requireOneLocation(req);
    if (b.supplierId) {
      const { rows } = await query("select 1 from suppliers where id = $1 and business_id = $2", [b.supplierId, req.biz]);
      if (!rows[0]) fail(400, "Supplier not found");
    }

    await tx(async (db) => {
      const { rows: [p] } = await db.query("select * from products where id = $1 and business_id = $2 for update", [req.params.id, req.biz]);
      if (!p) fail(404, "Product not found");
      const tracked = p.track_serials && req.business.features.serials;
      await db.query("insert into product_stock (business_id, product_id, location_id, quantity) values ($1,$2,$3,0) on conflict do nothing", [req.biz, p.id, loc.id]);
      const { rows: [s] } = await db.query("select quantity from product_stock where product_id = $1 and location_id = $2 for update", [p.id, loc.id]);
      const base = { biz: req.biz, productId: p.id, locationId: loc.id, supplierId: b.supplierId, unitCost: b.unitCost, note: b.note || null, userId: req.user.id };

      if (tracked) {
        if (b.type === "receive") {
          const list = b.serials || [];
          if (!list.length) fail(400, "Scan or type the serial number of each unit received", { code: "SERIALS_REQUIRED" });
          await serialsLib.addUnits(db, req.biz, { productId: p.id, locationId: loc.id, serials: list, cost: b.unitCost, supplierId: b.supplierId, event: "received", note: b.note || null, userId: req.user.id });
          await moveStock(db, { ...base, change: list.length, reason: "receive" });
        } else {
          const add = b.addSerials || [], remove = b.removeSerials || [];
          if (!add.length && !remove.length) fail(400, "List the serial numbers found or missing");
          if (remove.length) {
            const units = await serialsLib.lockInStock(db, req.biz, p.id, loc.id, remove, p.name);
            for (const u of units) await serialsLib.setStatus(db, req.biz, u.id, "missing", { event: "missing at stock count", note: b.note, userId: req.user.id });
            await moveStock(db, { ...base, change: -units.length, reason: "adjust" });
          }
          if (add.length) {
            await serialsLib.addUnits(db, req.biz, { productId: p.id, locationId: loc.id, serials: add, cost: b.unitCost, event: "found at stock count", note: b.note, userId: req.user.id });
            await moveStock(db, { ...base, change: add.length, reason: "adjust" });
          }
        }
      } else {
        if (b.quantity === undefined) fail(400, "Enter the quantity");
        if (b.type === "receive" && b.quantity < 1) fail(400, "Units received must be at least 1");
        const change = b.type === "receive" ? b.quantity : b.quantity - s.quantity;
        if (change === 0) fail(400, "Stock is already at that quantity");
        await moveStock(db, { ...base, change, reason: b.type });
      }
      if (b.type === "receive" && b.unitCost !== null) await db.query("update products set cost_price = $2 where id = $1", [p.id, b.unitCost]);
    });
    const { rows } = await query(`${productSelect(true)} and p.id = $3`, [req.biz, loc.id, req.params.id]);
    res.json(shape(rows[0], req.user));
  }
);

router.get(
  "/:id/movements",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ locationId: id }), "query"),
  async (req, res) => {
    const loc = stockLocation(req, req.validQuery.locationId);
    const { rows } = await query(
      `select m.*, u.first_name || ' ' || u.last_name as user_name, s.name as supplier_name, l.name as location_name,
              sa.invoice_number, r.return_number, t.transfer_number
         from stock_movements m
         left join users u on u.id = m.user_id
         left join suppliers s on s.id = m.supplier_id
         left join locations l on l.id = m.location_id
         left join sales sa on sa.id = m.sale_id
         left join returns r on r.id = m.return_id
         left join transfers t on t.id = m.transfer_id
        where m.business_id = $1 and m.product_id = $2 and ($3::uuid is null or m.location_id = $3::uuid)
        order by m.created_at desc, m.id
        limit 500`,
      [req.biz, req.params.id, loc]
    );
    res.json(rows.map((r) => toApi(r, ["business_id"])));
  }
);

module.exports = router;
