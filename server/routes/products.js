const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi, snake } = require("../lib/util");
const { Joi, validate, id, money, text } = require("../lib/validate");
const { requireRole, atLeast } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { likeParam } = require("../lib/crud");

// Cashiers never see cost prices.
const shape = (row, user) => toApi(row, atLeast(user, "manager") ? [] : ["cost_price"]);

// No defaults here: these rules are shared by create and update, and a default would
// overwrite existing values on update.
const barcode = text(64).allow("", null).empty(["", null]);
const fields = {
  name: text(120), description: text(500).allow(""), category: text(60),
  price: money, costPrice: money.allow(null, "").empty("").default(null), barcode,
  lowStockThreshold: Joi.number().integer().min(0).max(100000),
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
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const where = [], params = [];
    const p = (v) => { params.push(v); return "$" + params.length; };
    if (q.status !== "all") where.push(`active = ${q.status === "active"}`);
    if (q.filter) { const f = p(likeParam(q.filter)); where.push(`(name ilike ${f} or description ilike ${f} or barcode ilike ${f} or category ilike ${f})`); }
    if (q.category) where.push(`category = ${p(q.category)}`);
    if (q.lowStock) where.push("quantity <= low_stock_threshold");
    const w = where.length ? "where " + where.join(" and ") : "";
    const total = (await query(`select count(*)::int n from products ${w}`, params)).rows[0].n;
    const { rows } = await query(
      `select * from products ${w} order by ${snake(q.sortBy)} ${q.order}, id limit ${q.limit} offset ${(q.page - 1) * q.limit}`,
      params
    );
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, products: rows.map((r) => shape(r, req.user)) });
  }
);

router.get("/categories", async (req, res) => {
  const { rows } = await query("select distinct category from products where active order by category");
  res.json(rows.map((r) => r.category));
});

// Barcode lookup for the till scanner.
router.get("/barcode/:code", async (req, res) => {
  const { rows } = await query("select * from products where barcode = $1 and active", [String(req.params.code).trim()]);
  if (!rows[0]) fail(404, "No product with that barcode");
  res.json(shape(rows[0], req.user));
});

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query("select * from products where id = $1", [req.params.id]);
  if (!rows[0]) fail(404, "Product not found");
  res.json(shape(rows[0], req.user));
});

router.post(
  "/",
  requireRole("manager"),
  validate(Joi.object({
    ...fields,
    name: fields.name.required(), category: fields.category.required(), price: fields.price.required(),
    description: fields.description.default(""), lowStockThreshold: fields.lowStockThreshold.default(5),
    barcode: barcode.default(null), costPrice: money.allow(null, "").empty("").default(null),
    quantity: Joi.number().integer().min(0).max(10000000).default(0),
  })),
  async (req, res) => {
    const b = req.body;
    const product = await tx(async (db) => {
      const { rows } = await db.query(
        `insert into products (name, description, category, price, cost_price, barcode, low_stock_threshold, quantity)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [b.name, b.description, b.category, b.price, b.costPrice, b.barcode, b.lowStockThreshold, b.quantity]
      );
      if (b.quantity > 0) {
        await db.query(
          `insert into stock_movements (product_id, change, quantity_after, reason, unit_cost, note, user_id)
           values ($1, $2, $2, 'initial', $3, 'Opening stock', $4)`,
          [rows[0].id, b.quantity, b.costPrice, req.user.id]
        );
      }
      return rows[0];
    });
    res.status(201).json(shape(product, req.user));
  }
);

// Edit details. Stock quantity is NOT editable here; use /:id/stock so every change is recorded.
router.put(
  "/:id",
  requireRole("manager"),
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
      `update products set ${keys.map((k, i) => `${snake(k)} = $${i + 2}`).join(", ")} where id = $1 returning *`,
      [req.params.id, ...keys.map((k) => b[k])]
    );
    if (!rows[0]) fail(404, "Product not found");
    res.json(shape(rows[0], req.user));
  }
);

// "Delete" archives the product: it disappears from the till but its sales history stays.
router.delete("/:id", requireRole("manager"), validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query("update products set active = false where id = $1 returning id", [req.params.id]);
  if (!rows[0]) fail(404, "Product not found");
  res.json({ message: "Product archived" });
});

// Receive stock from a supplier, or correct the count after a stock-take.
router.post(
  "/:id/stock",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    type: Joi.string().valid("receive", "adjust").required(),
    quantity: Joi.when("type", {
      is: "receive",
      then: Joi.number().integer().min(1).max(10000000).required(),   // units received
      otherwise: Joi.number().integer().min(0).max(10000000).required(), // counted quantity on shelf
    }),
    supplierId: id.allow(null, "").empty(["", null]).default(null),
    unitCost: money.allow(null, "").empty(["", null]).default(null),
    note: Joi.when("type", { is: "adjust", then: text(300).min(1).required(), otherwise: text(300).allow("").default("") }),
  })),
  async (req, res) => {
    const b = req.body;
    const product = await tx(async (db) => {
      const { rows } = await db.query("select * from products where id = $1 for update", [req.params.id]);
      const p = rows[0];
      if (!p) fail(404, "Product not found");
      const change = b.type === "receive" ? b.quantity : b.quantity - p.quantity;
      if (change === 0) fail(400, "Stock is already at that quantity");
      const sets = ["quantity = quantity + $2"];
      const vals = [p.id, change];
      if (b.type === "receive" && b.unitCost !== null) { vals.push(b.unitCost); sets.push(`cost_price = $${vals.length}`); }
      const { rows: up } = await db.query(`update products set ${sets.join(", ")} where id = $1 returning *`, vals);
      await db.query(
        `insert into stock_movements (product_id, change, quantity_after, reason, supplier_id, unit_cost, note, user_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [p.id, change, up[0].quantity, b.type, b.supplierId, b.unitCost, b.note || null, req.user.id]
      );
      return up[0];
    });
    res.json(shape(product, req.user));
  }
);

// Full stock history for one product.
router.get(
  "/:id/movements",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  async (req, res) => {
    const { rows } = await query(
      `select m.*, u.first_name || ' ' || u.last_name as user_name, s.name as supplier_name,
              sa.invoice_number, r.return_number
         from stock_movements m
         left join users u on u.id = m.user_id
         left join suppliers s on s.id = m.supplier_id
         left join sales sa on sa.id = m.sale_id
         left join returns r on r.id = m.return_id
        where m.product_id = $1
        order by m.created_at desc
        limit 500`,
      [req.params.id]
    );
    res.json(rows.map((r) => toApi(r)));
  }
);

module.exports = router;
