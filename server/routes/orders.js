// Advance orders: the customer pays a deposit now and collects (pays the rest) later.
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi, round2 } = require("../lib/util");
const { Joi, validate, id, money, text, day } = require("../lib/validate");
const { fail } = require("../lib/errors");
const { requireOneLocation, canAccessLocation } = require("../lib/location");
const { getSettings } = require("../lib/settings");
const { nextNumber } = require("../lib/counters");
const { recordPayment } = require("../lib/payments");
const { createSale } = require("../lib/saleService");
const { loadSales } = require("../lib/sales");
const { likeParam } = require("../lib/crud");

const SELECT = `
  select o.*, l.name as location_name, sa.invoice_number,
         (select json_agg(json_build_object('_id', i.id, 'product', i.product_id, 'name', i.name, 'quantity', i.quantity, 'price', i.price,
                 'trackSerials', p.track_serials) order by i.name)
            from order_items i join products p on p.id = i.product_id where i.order_id = o.id) as items
    from orders o join locations l on l.id = o.location_id left join sales sa on sa.id = o.sale_id`;
const shape = (o) => ({
  ...toApi(o, ["business_id", "items", "location_name", "invoice_number"]),
  location: { _id: o.location_id, name: o.location_name }, invoiceNumber: o.invoice_number,
  items: o.items || [], balance: round2(o.total - o.deposit_paid),
});
const load = async (db, biz, oid, lock = false) => (await db.query(`${SELECT} where o.id = $1 and o.business_id = $2 ${lock ? "for update of o" : ""}`, [oid, biz])).rows[0];
const payMethod = Joi.string().valid("Cash", "Card", "Bank");

const takeMoney = async (db, req, order, { amount, method, kind }) => {
  const { rows: shifts } = await db.query("select id, location_id from shifts where user_id = $1 and business_id = $2 and closed_at is null", [req.user.id, req.biz]);
  if (method === "Cash" && !shifts[0]) fail(409, "Open a shift to take or give back cash (it's your drawer)", { code: "SHIFT_REQUIRED" });
  await recordPayment(db, { biz: req.biz, locationId: shifts[0]?.location_id || order.location_id, shiftId: shifts[0]?.id, userId: req.user.id,
    orderId: order.id, kind, method, amount, reference: order.order_number });
};

router.get("/", validate(Joi.object({ status: Joi.string().valid("open", "all", "ready", "completed", "cancelled").default("open"), q: Joi.string().trim().allow("").max(80).default("") }), "query"), async (req, res) => {
  const q = req.validQuery;
  const where = ["o.business_id = $1"], params = [req.biz];
  const add = (fn, v) => { params.push(v); where.push(fn("$" + params.length)); };
  if (q.status === "open") where.push("o.status in ('open','ready')");
  else if (q.status !== "all") add((x) => `o.status = ${x}`, q.status);
  if (q.q) add((x) => `(o.order_number ilike ${x} or o.customer_name ilike ${x} or o.customer_phone ilike ${x})`, likeParam(q.q));
  const loc = req.user.role === "owner" ? req.location?.id : req.user.locationId;
  if (loc) add((x) => `o.location_id = ${x}`, loc);
  const { rows } = await query(`${SELECT} where ${where.join(" and ")} order by o.created_at desc limit 300`, params);
  res.json(rows.map(shape));
});

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const o = await load({ query }, req.biz, req.params.id);
  if (!o || !canAccessLocation(req.user, o.location_id)) fail(404, "Order not found");
  const { rows: pays } = await query("select amount, method, kind, created_at from payments where order_id = $1 order by created_at", [o.id]);
  res.json({ ...shape(o), payments: pays.map((p) => toApi(p)) });
});

router.post(
  "/",
  validate(Joi.object({
    customer: id.allow(null, "").empty(["", null]),
    customerName: text(120).min(1).required(),
    customerPhone: text(40).min(3).required(),
    items: Joi.array().min(1).max(100).items(Joi.object({ product: id.required(), quantity: Joi.number().integer().min(1).max(10000).required() })).required(),
    deposit: Joi.object({ amount: money.greater(0).required(), method: payMethod.required() }),
    dueDate: day.allow(null, "").empty(["", null]),
    note: text(500).allow(""),
  })),
  async (req, res) => {
    const b = req.body;
    const loc = await requireOneLocation(req, { storeOnly: true });
    const oid = await tx(async (db) => {
      if (b.customer) {
        const { rows } = await db.query("select id from customers where id = $1 and business_id = $2", [b.customer, req.biz]);
        if (!rows[0]) fail(400, "Customer not found");
      }
      const ids = [...new Set(b.items.map((i) => i.product))];
      const { rows: prods } = await db.query("select id, name, variant, price from products where id = any($1::uuid[]) and business_id = $2 and active", [ids, req.biz]);
      if (prods.length !== ids.length) fail(400, "A product in the order doesn't exist");
      const pm = new Map(prods.map((p) => [p.id, p]));
      const total = round2(b.items.reduce((t, i) => t + pm.get(i.product).price * i.quantity, 0));
      if (b.deposit && b.deposit.amount > total) fail(400, "The deposit is more than the order total");
      const number = await nextNumber(db, req.biz, "order");
      const { rows: [o] } = await db.query(
        `insert into orders (business_id, order_number, location_id, customer_id, customer_name, customer_phone, total, deposit_paid, due_date, note, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [req.biz, number, loc.id, b.customer || null, b.customerName, b.customerPhone, total, b.deposit?.amount || 0, b.dueDate || null, b.note || null, req.user.id]
      );
      for (const i of b.items) {
        const p = pm.get(i.product);
        await db.query("insert into order_items (order_id, product_id, name, quantity, price) values ($1,$2,$3,$4,$5)", [o.id, p.id, p.variant ? `${p.name} ${p.variant}` : p.name, i.quantity, p.price]);
      }
      if (b.deposit) await takeMoney(db, req, o, { amount: b.deposit.amount, method: b.deposit.method, kind: "deposit" });
      return o.id;
    });
    res.status(201).json(shape(await load({ query }, req.biz, oid)));
  }
);

router.post(
  "/:id/deposit",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ amount: money.greater(0).required(), method: payMethod.required() })),
  async (req, res) => {
    await tx(async (db) => {
      const o = await load(db, req.biz, req.params.id, true);
      if (!o || !canAccessLocation(req.user, o.location_id)) fail(404, "Order not found");
      if (!["open", "ready"].includes(o.status)) fail(409, `This order is ${o.status}`);
      if (round2(o.deposit_paid + req.body.amount) > o.total) fail(400, `Only ${round2(o.total - o.deposit_paid)} is left to pay`);
      await db.query("update orders set deposit_paid = deposit_paid + $2 where id = $1", [o.id, req.body.amount]);
      await takeMoney(db, req, o, { amount: req.body.amount, method: req.body.method, kind: "deposit" });
    });
    res.json(shape(await load({ query }, req.biz, req.params.id)));
  }
);

router.post("/:id/ready", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query("update orders set status = 'ready' where id = $1 and business_id = $2 and status = 'open' returning location_id", [req.params.id, req.biz]);
  if (!rows[0]) fail(409, "Only open orders can be marked ready");
  res.json(shape(await load({ query }, req.biz, req.params.id)));
});

// Customer collects: becomes a sale; the deposit counts towards it, the rest is paid now.
router.post(
  "/:id/complete",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    payments: Joi.array().max(5).items(Joi.object({ method: payMethod.required(), amount: money.required() })).default([]),
    cashTendered: money.allow(null),
    serials: Joi.object().pattern(id, Joi.array().items(text(64))).default({}),   // order item id -> serials
    clientRef: id,
  })),
  async (req, res) => {
    const settings = await getSettings(req.biz);
    const saleId = await tx(async (db) => {
      const o = await load(db, req.biz, req.params.id, true);
      if (!o || !canAccessLocation(req.user, o.location_id)) fail(404, "Order not found");
      if (!["open", "ready"].includes(o.status)) fail(409, `This order is ${o.status}`);
      const r = await createSale(db, { biz: req.biz, user: req.user, features: req.business.features, settings, location: req.location }, {
        clientRef: req.body.clientRef,
        items: o.items.map((i) => ({ product: i.product, quantity: i.quantity, serials: req.body.serials[i._id] || [] })),
        customer: o.customer_id, customerName: o.customer_name,
        payments: req.body.payments, cashTendered: req.body.cashTendered,
        deposit: o.deposit_paid > 0 ? { orderId: o.id, amount: o.deposit_paid } : null,
      });
      await db.query("update orders set status = 'completed', sale_id = $2, completed_at = now() where id = $1", [o.id, r.saleId]);
      return r.saleId;
    });
    const [sale] = await loadSales({ query }, req.biz, "s.id = $2", [saleId], { full: true });
    res.json({ order: shape(await load({ query }, req.biz, req.params.id)), sale });
  }
);

router.post(
  "/:id/cancel",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ reason: text(300).min(1).required(), refundMethod: payMethod.default("Cash"), keepDeposit: Joi.boolean().default(false) })),
  async (req, res) => {
    await tx(async (db) => {
      const o = await load(db, req.biz, req.params.id, true);
      if (!o || !canAccessLocation(req.user, o.location_id)) fail(404, "Order not found");
      if (!["open", "ready"].includes(o.status)) fail(409, `This order is ${o.status}`);
      if (o.deposit_paid > 0 && !req.body.keepDeposit) {
        await takeMoney(db, req, o, { amount: -o.deposit_paid, method: req.body.refundMethod, kind: "deposit_refund" });
      }
      await db.query("update orders set status = 'cancelled', note = coalesce(note || '. ', '') || $2 where id = $1", [o.id, `Cancelled: ${req.body.reason}`]);
    });
    res.json(shape(await load({ query }, req.biz, req.params.id)));
  }
);

module.exports = router;
