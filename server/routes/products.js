const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi, snake, isId } = require("../lib/util");
const { Joi, validate, id, money, text } = require("../lib/validate");
const { requireRole, atLeast } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { likeParam } = require("../lib/crud");
const { requireOneLocation, canAccessLocation, getLocation } = require("../lib/location");
const { moveStock } = require("../lib/stock");

// Cashiers never see cost prices.
const shape = (row, user) => {
  const out = toApi(row, atLeast(user, "manager") ? [] : ["cost_price"]);
  if (row.stock_by_location) out.stockByLocation = row.stock_by_location;
  return out;
};

// Which location's stock to show: ?locationId=..., else the request's branch, else all branches (owner).
const stockLocation = (req, qLoc) => {
  if (qLoc) {
    if (!canAccessLocation(req.user, qLoc)) fail(403, "You can only see your own branch");
    return qLoc;
  }
  return req.location?.id || null;
};

// SELECT products with quantity for one location (or total over active locations when loc is null).
const productSelect = (locParam, withStock) => `
  select p.*, q.quantity
         ${withStock ? `, (select json_agg(json_build_object('locationId', l.id, 'name', l.name, 'type', l.type, 'quantity', coalesce(ps.quantity, 0)) order by l.type desc, l.created_at)
                            from locations l left join product_stock ps on ps.location_id = l.id and ps.product_id = p.id
                           where l.active) as stock_by_location` : ""}
    from products p
    cross join lateral (
      select coalesce(sum(ps.quantity), 0)::int as quantity
        from product_stock ps join locations l on l.id = ps.location_id
       where ps.product_id = p.id and (${locParam}::uuid is null and l.active or ps.location_id = ${locParam}::uuid)
    ) q`;

// No defaults here: these rules are shared by create and update, and a default would
// overwrite existing values on update.
const barcode = text(64).allow("", null).empty(["", null]);
const fields = {
  name: text(120), description: text(500).allow(""), category: text(60),
  price: money, barcode, lowStockThreshold: Joi.number().integer().min(0).max(100000),
};

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
    const params = [loc];
    const where = [];
    const p = (v) => { params.push(v); return "$" + params.length; };
    if (q.status !== "all") where.push(`p.active = ${q.status === "active"}`);
    if (q.filter) { const f = p(likeParam(q.filter)); where.push(`(p.name ilike ${f} or p.description ilike ${f} or p.barcode ilike ${f} or p.category ilike ${f})`); }
    if (q.category) where.push(`p.category = ${p(q.category)}`);
    if (q.lowStock) where.push("q.quantity <= p.low_stock_threshold");
    const w = where.length ? "where " + where.join(" and ") : "";
    const base = productSelect("$1", q.withStock && atLeast(req.user, "manager"));
    const total = (await query(`select count(*)::int n from (${base} ${w}) x`, params)).rows[0].n;
    const sortCol = q.sortBy === "quantity" ? "q.quantity" : "p." + snake(q.sortBy);
    const { rows } = await query(`${base} ${w} order by ${sortCol} ${q.order}, p.id limit ${q.limit} offset ${(q.page - 1) * q.limit}`, params);
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, locationId: loc, products: rows.map((r) => shape(r, req.user)) });
  }
);

router.get("/categories", async (req, res) => {
  const { rows } = await query("select distinct category from products where active order by category");
  res.json(rows.map((r) => r.category));
});

// Barcode lookup for the till scanner (stock shown for the till's branch).
router.get("/barcode/:code", validate(Joi.object({ locationId: id }), "query"), async (req, res) => {
  const loc = stockLocation(req, req.validQuery.locationId);
  const { rows } = await query(`${productSelect("$1", false)} where p.barcode = $2 and p.active`, [loc, String(req.params.code).trim()]);
  if (!rows[0]) fail(404, "No product with that barcode");
  res.json(shape(rows[0], req.user));
});

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query(`${productSelect("$1", atLeast(req.user, "manager"))} where p.id = $2`, [req.location?.id || null, req.params.id]);
  if (!rows[0]) fail(404, "Product not found");
  res.json(shape(rows[0], req.user));
});

// Products and prices are shared by all branches, so only the owner adds or edits them.
router.post(
  "/",
  requireRole("owner"),
  validate(Joi.object({
    ...fields,
    name: fields.name.required(), category: fields.category.required(), price: fields.price.required(),
    description: fields.description.default(""), lowStockThreshold: fields.lowStockThreshold.default(5),
    barcode: barcode.default(null), costPrice: money.allow(null, "").empty("").default(null),
    quantity: Joi.number().integer().min(0).max(10000000).default(0),   // opening stock...
    locationId: id,                                                      // ...at this branch
  })),
  async (req, res) => {
    const b = req.body;
    let openingLoc = null;
    if (b.quantity > 0) {
      openingLoc = b.locationId ? await getLocation({ query }, b.locationId) : await requireOneLocation(req);
      if (!openingLoc) fail(400, "Branch not found");
    }
    const product = await tx(async (db) => {
      const { rows } = await db.query(
        `insert into products (name, description, category, price, cost_price, barcode, low_stock_threshold)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [b.name, b.description, b.category, b.price, b.costPrice, b.barcode, b.lowStockThreshold]
      );
      await db.query("insert into product_stock (product_id, location_id, quantity) select $1, id, 0 from locations on conflict do nothing", [rows[0].id]);
      if (b.quantity > 0) {
        await moveStock(db, { productId: rows[0].id, locationId: openingLoc.id, change: b.quantity, reason: "initial", unitCost: b.costPrice, note: "Opening stock", userId: req.user.id });
      }
      return rows[0];
    });
    const { rows } = await query(`${productSelect("$1", true)} where p.id = $2`, [openingLoc?.id || req.location?.id || null, product.id]);
    res.status(201).json(shape(rows[0], req.user));
  }
);

// Edit details. Stock is NOT editable here; use /:id/stock so every change is recorded.
router.put(
  "/:id",
  requireRole("owner"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    ...fields, barcode: text(64).allow("", null), costPrice: money.allow(null, ""), active: Joi.boolean(),
  }).min(1)),
  async (req, res) => {
    const b = { ...req.body };
    if (b.costPrice === "") b.costPrice = null;
    if (b.barcode === "") b.barcode = null;
    const keys = Object.keys(b);
    const { rows } = await query(
      `update products set ${keys.map((k, i) => `${snake(k)} = $${i + 2}`).join(", ")} where id = $1 returning id`,
      [req.params.id, ...keys.map((k) => b[k])]
    );
    if (!rows[0]) fail(404, "Product not found");
    const { rows: full } = await query(`${productSelect("$1", true)} where p.id = $2`, [req.location?.id || null, req.params.id]);
    res.json(shape(full[0], req.user));
  }
);

// "Delete" archives the product: it disappears from the tills but its history stays.
router.delete("/:id", requireRole("owner"), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query("update products set active = false where id = $1 returning id", [req.params.id]);
  if (!rows[0]) fail(404, "Product not found");
  res.json({ message: "Product archived" });
});

// Receive a delivery, or correct the count after a stock-take, at one branch.
router.post(
  "/:id/stock",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    type: Joi.string().valid("receive", "adjust").required(),
    quantity: Joi.when("type", {
      is: "receive",
      then: Joi.number().integer().min(1).max(10000000).required(),
      otherwise: Joi.number().integer().min(0).max(10000000).required(),
    }),
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
      loc = await getLocation({ query }, b.locationId);
      if (!loc) fail(404, "Branch not found");
    } else loc = await requireOneLocation(req);

    await tx(async (db) => {
      const { rows: [p] } = await db.query("select * from products where id = $1 for update", [req.params.id]);
      if (!p) fail(404, "Product not found");
      await db.query("insert into product_stock (product_id, location_id, quantity) values ($1,$2,0) on conflict do nothing", [p.id, loc.id]);
      const { rows: [s] } = await db.query("select quantity from product_stock where product_id = $1 and location_id = $2 for update", [p.id, loc.id]);
      const change = b.type === "receive" ? b.quantity : b.quantity - s.quantity;
      if (change === 0) fail(400, "Stock is already at that quantity");
      await moveStock(db, { productId: p.id, locationId: loc.id, change, reason: b.type, supplierId: b.supplierId, unitCost: b.unitCost, note: b.note || null, userId: req.user.id });
      if (b.type === "receive" && b.unitCost !== null) await db.query("update products set cost_price = $2 where id = $1", [p.id, b.unitCost]);
    });
    const { rows } = await query(`${productSelect("$1", true)} where p.id = $2`, [loc.id, req.params.id]);
    res.json(shape(rows[0], req.user));
  }
);

// Stock history for one product (one branch, or all branches for the owner).
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
        where m.product_id = $1 and ($2::uuid is null or m.location_id = $2::uuid)
        order by m.created_at desc, m.id
        limit 500`,
      [req.params.id, loc]
    );
    res.json(rows.map((r) => toApi(r)));
  }
);

module.exports = router;
module.exports.productSelect = productSelect;
