const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { Joi, validate, id, money, percent, text, day } = require("../lib/validate");
const { requireRole } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { getSettings } = require("../lib/settings");
const { dayRange } = require("../lib/dates");
const { likeParam } = require("../lib/crud");
const { loadSales } = require("../lib/sales");
const { createSale, voidSale, returnItems } = require("../lib/saleService");

const ctxOf = async (req) => ({ biz: req.biz, user: req.user, features: req.business.features, settings: await getSettings(req.biz), location: req.location });

const saleSchema = Joi.object({
  clientRef: id,
  items: Joi.array().min(1).max(500).items(Joi.object({
    product: id.required(),
    quantity: Joi.number().integer().min(1).max(100000).required(),
    discount: money.default(0),                         // amount off this line
    serials: Joi.array().items(text(64).min(1)).max(1000).default([]),
    price: money,                                       // offline sales only
    name: text(160),                                    // offline sales only
  })).required(),
  customer: id.allow(null, "").empty(["", null]),
  customerName: text(120).allow(""),
  discount: percent.default(0),
  taxRate: percent.default(0),
  payments: Joi.array().max(5).items(Joi.object({ method: Joi.string().valid("Cash", "Card", "Bank").required(), amount: money.required() })),
  cashTendered: money.allow(null),
  paymentMethod: Joi.string().valid("Cash", "Card", "Bank"),   // older tills
  amountTendered: money.allow(null).empty(null),               // older tills
  tradeIn: Joi.object({
    description: text(200).min(1).required(), serial: text(64).allow(""), condition: text(200).allow(""),
    value: money.greater(0).required(), productId: id.allow(null, "").empty(["", null]),
  }),
  installment: Joi.object({
    months: Joi.number().integer().min(1).max(60).required(),
    firstDue: day, fee: money.default(0), note: text(300).allow(""),
  }),
  approval: Joi.object({ userId: id.required(), pin: Joi.string().max(12).required() }),
  offline: Joi.boolean().default(false),
  createdAt: Joi.date().iso(),
  shiftId: id.allow(null).empty(null),
}).or("payments", "paymentMethod", "installment", "tradeIn");

router.post("/", validate(saleSchema), async (req, res) => {
  const b = req.body;
  if (b.clientRef) {
    const existing = await loadSales({ query }, req.biz, "s.client_ref = $2", [b.clientRef], { full: true });
    if (existing[0]) return res.status(200).json({ message: "Sale already recorded", sale: existing[0], duplicate: true });
  }
  const ctx = await ctxOf(req);
  let result;
  try {
    result = await tx((db) => createSale(db, ctx, b));
  } catch (err) {
    if (err.code === "23505" && err.constraint === "sales_client_ref_key") {
      const existing = await loadSales({ query }, req.biz, "s.client_ref = $2", [b.clientRef], { full: true });
      return res.status(200).json({ message: "Sale already recorded", sale: existing[0], duplicate: true });
    }
    throw err;
  }
  const [sale] = await loadSales({ query }, req.biz, "s.id = $2", [result.saleId], { full: true });
  res.status(201).json({ message: "Sale recorded", sale });
});

router.get(
  "/",
  validate(Joi.object({
    from: day, to: day,
    q: Joi.string().trim().allow("").max(100).default(""),
    status: Joi.string().valid("all", "Paid", "Voided").default("all"),
    payment: Joi.string().valid("all", "Cash", "Card", "Bank", "Split", "Installment").default("all"),
    offline: Joi.boolean(),
    shiftId: id,
    locationId: id,
    customerId: id,
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(500).default(25),
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const { timezone } = await getSettings(req.biz);
    const where = [], params = [];
    const add = (sqlFn, v) => { params.push(v); where.push(sqlFn("$" + (params.length + 1))); };
    const r = dayRange("s.date", q.from, q.to, timezone, 2);
    if (r.sql) { where.push(r.sql); params.push(...r.params); }
    if (q.q) add((p) => `(s.invoice_number ilike ${p} or s.customer_name ilike ${p} or exists (
        select 1 from sale_item_serials z join sale_items i on i.id = z.sale_item_id where i.sale_id = s.id and z.serial ilike ${p}))`, likeParam(q.q));
    if (q.status !== "all") add((p) => `s.payment_status = ${p}`, q.status);
    if (q.payment !== "all") add((p) => `s.payment_method = ${p}`, q.payment);
    if (q.offline !== undefined) add((p) => `s.offline = ${p}`, q.offline);
    if (q.shiftId) add((p) => `s.shift_id = ${p}`, q.shiftId);
    if (q.customerId) add((p) => `s.customer_id = ${p}`, q.customerId);
    if (req.user.role === "cashier") add((p) => `s.cashier_id = ${p}`, req.user.id);
    else if (req.user.role === "manager") add((p) => `s.location_id = ${p}`, req.user.locationId);
    else if (q.locationId || req.location) add((p) => `s.location_id = ${p}`, q.locationId || req.location.id);
    const w = where.join(" and ");
    const total = (await query(`select count(*)::int n from sales s where s.business_id = $1 ${w ? "and " + w : ""}`, [req.biz, ...params])).rows[0].n;
    const sales = await loadSales({ query }, req.biz, w, params, {
      orderLimit: `order by s.date desc, s.invoice_number desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`,
    });
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, sales });
  }
);

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const [sale] = await loadSales({ query }, req.biz, "s.id = $2", [req.params.id], { full: true });
  if (!sale) fail(404, "Sale not found");
  if (req.user.role === "cashier" && sale.cashier?._id !== req.user.id) fail(403, "You can only view your own sales");
  if (req.user.role === "manager" && sale.location?._id !== req.user.locationId) fail(403, "You can only view your own branch's sales");
  res.json(sale);
});

router.post(
  "/:id/void",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ reason: text(300).min(1).required() })),
  async (req, res) => {
    const ctx = await ctxOf(req);
    await tx((db) => voidSale(db, ctx, req.params.id, req.body.reason));
    const [sale] = await loadSales({ query }, req.biz, "s.id = $2", [req.params.id], { full: true });
    res.json({ message: "Sale voided and stock restored", sale });
  }
);

router.post(
  "/:id/returns",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    items: Joi.array().min(1).max(500).items(Joi.object({
      saleItemId: id.required(),
      quantity: Joi.number().integer().min(1).required(),
      restock: Joi.boolean().default(true),
      serials: Joi.array().items(text(64)).default([]),
    })).required(),
    reason: text(300).min(1).required(),
    refundMethod: Joi.string().valid("Cash", "Card", "Bank", "Credit"),
  })),
  async (req, res) => {
    const ctx = await ctxOf(req);
    const ret = await tx((db) => returnItems(db, ctx, req.params.id, req.body));
    const [sale] = await loadSales({ query }, req.biz, "s.id = $2", [req.params.id], { full: true });
    res.status(201).json({ message: `Return ${ret.return_number} recorded`, returnNumber: ret.return_number, refundAmount: ret.refund_amount, refundMethod: ret.refund_method, sale });
  }
);

router.delete("/:id", (req, res) => res.status(405).json({ message: "Sales cannot be deleted. Void the sale instead." }));

module.exports = router;
