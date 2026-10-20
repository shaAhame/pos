const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { round2 } = require("../lib/util");
const { Joi, validate, id, money, percent, text, day } = require("../lib/validate");
const { atLeast, requireRole } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { getSettings } = require("../lib/settings");
const { dayRange } = require("../lib/dates");
const { likeParam } = require("../lib/crud");
const { computeTotals, unitRefund, loadSales } = require("../lib/sales");

const saleSchema = Joi.object({
  clientRef: id,                          // unique id made by the till; makes retries safe
  items: Joi.array().min(1).max(500).items(Joi.object({
    product: id.required(),
    quantity: Joi.number().integer().min(1).max(100000).required(),
    price: money,                         // only used for offline sales
    name: text(120),                      // only used for offline sales
  })).required(),
  customer: id.allow(null, "").empty(["", null]),
  customerName: text(120).allow(""),
  paymentMethod: Joi.string().valid("Cash", "Card").required(),
  discount: percent.default(0),
  taxRate: percent.default(0),
  amountTendered: money.allow(null).empty(null),
  offline: Joi.boolean().default(false),
  createdAt: Joi.date().iso(),            // offline: when the sale really happened
  shiftId: id.allow(null).empty(null),    // offline: the shift it happened in
});

// Create a sale. Online: strict (stock, prices, shift and discount limits are enforced).
// Offline sync: the money was already taken, so the sale is always recorded; anything
// unusual (stock shortfall, changed price) is written to offline_note for a manager to review.
router.post("/", validate(saleSchema), async (req, res) => {
  const b = req.body;
  const user = req.user;
  const offline = b.offline;

  if (b.clientRef) {
    const existing = await loadSales({ query }, "where s.client_ref = $1", [b.clientRef], { withReturns: true });
    if (existing[0]) return res.status(200).json({ message: "Sale already recorded", sale: existing[0], duplicate: true });
  }

  const settings = await getSettings();
  const notes = [];

  if (user.role === "cashier" && b.discount > settings.maxCashierDiscount) {
    if (!offline) fail(403, `Cashiers can give at most ${settings.maxCashierDiscount}% discount. Ask a manager.`);
    notes.push(`Discount ${b.discount}% is above the cashier limit of ${settings.maxCashierDiscount}%`);
  }

  // Merge duplicate lines.
  const wanted = new Map();
  for (const it of b.items) {
    const cur = wanted.get(it.product);
    wanted.set(it.product, { ...it, quantity: (cur ? cur.quantity : 0) + it.quantity });
  }

  let saleId;
  try {
    saleId = await tx(async (db) => {
      // Shift
      let shiftId = null;
      if (offline && b.shiftId) {
        const { rows } = await db.query("select id from shifts where id = $1 and user_id = $2", [b.shiftId, user.id]);
        if (rows[0]) shiftId = rows[0].id;
      }
      if (!shiftId) {
        const { rows } = await db.query("select id from shifts where user_id = $1 and closed_at is null", [user.id]);
        if (rows[0]) shiftId = rows[0].id;
        else if (!offline) fail(409, "Open a shift before selling", { code: "SHIFT_REQUIRED" });
        else notes.push("No open shift when synced");
      }

      // Customer
      let customerId = null;
      let customerName = (b.customerName || "").trim() || "Walk-in Customer";
      if (b.customer) {
        const { rows } = await db.query("select id, name from customers where id = $1", [b.customer]);
        if (rows[0]) { customerId = rows[0].id; customerName = rows[0].name; }
        else if (!offline) fail(400, "Customer not found");
      }

      // Lock all products in a fixed order (prevents deadlocks between tills).
      const ids = [...wanted.keys()].sort();
      const { rows: prods } = await db.query(
        "select * from products where id = any($1::uuid[]) order by id for update", [ids]
      );
      const byId = new Map(prods.map((p) => [p.id, p]));

      const lines = [];
      for (const pid of ids) {
        const want = wanted.get(pid);
        const p = byId.get(pid);
        if (!p) {
          if (!offline) fail(409, "A product in the cart no longer exists", { productId: pid });
          if (want.price === undefined || !want.name) fail(400, "Offline sale line is missing name or price");
          notes.push(`"${want.name}" not found in products; stock not changed`);
          lines.push({ productId: null, name: want.name, quantity: want.quantity, price: want.price, cost: null, deduct: 0 });
          continue;
        }
        if (!offline) {
          if (!p.active) fail(409, `"${p.name}" is no longer sold`, { productId: pid });
          if (p.quantity < want.quantity) {
            fail(409, `Not enough stock for "${p.name}" (available: ${p.quantity}, requested: ${want.quantity})`, { productId: pid, available: p.quantity });
          }
        }
        let price = p.price;
        if (offline && want.price !== undefined) {
          if (want.price !== p.price) notes.push(`"${p.name}" sold at ${want.price} offline (current price ${p.price})`);
          price = want.price;
        }
        const deduct = Math.min(want.quantity, p.quantity);
        if (deduct < want.quantity) notes.push(`"${p.name}": sold ${want.quantity} but only ${p.quantity} in stock`);
        lines.push({ productId: p.id, name: p.name, quantity: want.quantity, price, cost: p.cost_price, deduct, shortfall: want.quantity - deduct });
      }
      for (const l of lines) l.total = round2(l.price * l.quantity);

      const t = computeTotals(lines, b.discount, b.taxRate);

      let tendered = null, change = null;
      if (b.paymentMethod === "Cash" && b.amountTendered !== undefined) {
        if (b.amountTendered < t.totalAmount) {
          if (!offline) fail(400, `Amount tendered is less than the total (${t.totalAmount})`);
        } else {
          tendered = b.amountTendered;
          change = round2(b.amountTendered - t.totalAmount);
        }
      }

      // When did it happen? Offline sales keep their real time (if believable).
      let date = new Date();
      if (offline && b.createdAt) {
        const ts = new Date(b.createdAt);
        const ageMs = Date.now() - ts.getTime();
        if (ageMs > -5 * 60e3 && ageMs < 30 * 24 * 3600e3) date = ts;
        else notes.push(`Original time ${ts.toISOString()} looked wrong; using sync time`);
      }

      const { rows: [sale] } = await db.query(
        `insert into sales (invoice_number, client_ref, customer_id, customer_name, subtotal, discount, discount_amount,
                            tax_rate, tax_amount, total_amount, payment_status, payment_method, amount_tendered, change_given,
                            cashier_id, shift_id, offline, offline_note, synced_at, date)
         values ('INV-' || lpad(nextval('invoice_seq')::text, 6, '0'), $1,$2,$3,$4,$5,$6,$7,$8,$9,'Paid',$10,$11,$12,$13,$14,$15,$16,$17,$18)
         returning id`,
        [b.clientRef || null, customerId, customerName, t.subtotal, b.discount, t.discountAmount, b.taxRate, t.taxAmount,
         t.totalAmount, b.paymentMethod, tendered, change, user.id, shiftId, offline, notes.length ? notes.join("; ") : null,
         offline ? new Date() : null, date]
      );

      for (const l of lines) {
        await db.query(
          `insert into sale_items (sale_id, product_id, name, quantity, price, total, cost_price) values ($1,$2,$3,$4,$5,$6,$7)`,
          [sale.id, l.productId, l.name, l.quantity, l.price, l.total, l.cost]
        );
        if (!l.productId) continue;
        if (l.deduct > 0) {
          const { rows: [up] } = await db.query(
            "update products set quantity = quantity - $2 where id = $1 returning quantity", [l.productId, l.deduct]
          );
          await db.query(
            `insert into stock_movements (product_id, change, quantity_after, reason, sale_id, user_id) values ($1,$2,$3,'sale',$4,$5)`,
            [l.productId, -l.deduct, up.quantity, sale.id, user.id]
          );
        }
        if (l.shortfall > 0) {
          await db.query(
            `insert into stock_movements (product_id, change, quantity_after, reason, sale_id, note, user_id)
             values ($1, 0, 0, 'offline_shortfall', $2, $3, $4)`,
            [l.productId, sale.id, `Sold ${l.shortfall} more than recorded stock while offline - recount this product`, user.id]
          );
        }
      }
      return sale.id;
    });
  } catch (err) {
    // Same clientRef sent twice at the same moment: return the one that won.
    if (err.code === "23505" && err.constraint === "sales_client_ref_key") {
      const existing = await loadSales({ query }, "where s.client_ref = $1", [b.clientRef], { withReturns: true });
      return res.status(200).json({ message: "Sale already recorded", sale: existing[0], duplicate: true });
    }
    throw err;
  }

  const [sale] = await loadSales({ query }, "where s.id = $1", [saleId], { withReturns: true });
  res.status(201).json({ message: "Sale recorded", sale });
});

// Sales list with filters. Cashiers only see their own sales.
router.get(
  "/",
  validate(Joi.object({
    from: day, to: day,
    q: Joi.string().trim().allow("").max(100).default(""),
    status: Joi.string().valid("all", "Paid", "Voided").default("all"),
    payment: Joi.string().valid("all", "Cash", "Card").default("all"),
    offline: Joi.boolean(),
    shiftId: id,
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(500).default(25),
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const { timezone } = await getSettings();
    const where = [], params = [];
    const add = (sqlFn, v) => { params.push(v); where.push(sqlFn("$" + params.length)); };
    const r = dayRange("s.date", q.from, q.to, timezone, 1);
    if (r.sql) { where.push(r.sql); params.push(...r.params); }
    if (q.q) add((p) => `(s.invoice_number ilike ${p} or s.customer_name ilike ${p})`, likeParam(q.q));
    if (q.status !== "all") add((p) => `s.payment_status = ${p}`, q.status);
    if (q.payment !== "all") add((p) => `s.payment_method = ${p}`, q.payment);
    if (q.offline !== undefined) add((p) => `s.offline = ${p}`, q.offline);
    if (q.shiftId) add((p) => `s.shift_id = ${p}`, q.shiftId);
    if (!atLeast(req.user, "manager")) add((p) => `s.cashier_id = ${p}`, req.user.id);
    const w = where.length ? "where " + where.join(" and ") : "";
    const total = (await query(`select count(*)::int n from sales s ${w}`, params)).rows[0].n;
    const sales = await loadSales({ query }, w, params, {
      orderLimit: `order by s.date desc, s.invoice_number desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`,
    });
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, sales });
  }
);

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const [sale] = await loadSales({ query }, "where s.id = $1", [req.params.id], { withReturns: true });
  if (!sale) fail(404, "Sale not found");
  if (!atLeast(req.user, "manager") && sale.cashier?._id !== req.user.id) fail(403, "You can only view your own sales");
  res.json(sale);
});

// Void: cancels a sale completely (e.g. rung up by mistake). Only while its shift is still open;
// after the shift is cashed up, use a return instead so the cash-up stays correct.
router.post(
  "/:id/void",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ reason: text(300).min(1).required() })),
  async (req, res) => {
    await tx(async (db) => {
      const { rows: [s] } = await db.query(
        `select s.*, sh.closed_at as shift_closed_at from sales s left join shifts sh on sh.id = s.shift_id where s.id = $1 for update of s`,
        [req.params.id]
      );
      if (!s) fail(404, "Sale not found");
      if (s.payment_status === "Voided") fail(409, "Sale is already voided");
      if (s.shift_closed_at) fail(409, "This sale's shift is already closed. Use a return instead.");
      if (!s.shift_id && Date.now() - new Date(s.date).getTime() > 24 * 3600e3) fail(409, "Sales older than a day can't be voided. Use a return instead.");
      const { rows: [{ n }] } = await db.query("select count(*)::int n from returns where sale_id = $1", [s.id]);
      if (n > 0) fail(409, "This sale has returns, so it can't be voided");

      await db.query(
        "update sales set payment_status = 'Voided', voided_at = now(), voided_by = $2, void_reason = $3 where id = $1",
        [s.id, req.user.id, req.body.reason]
      );
      // Put back exactly what the sale took from stock (per its stock movements).
      const { rows: taken } = await db.query(
        `select product_id, -sum(change)::int as qty from stock_movements
          where sale_id = $1 and reason = 'sale' group by product_id order by product_id`,
        [s.id]
      );
      for (const t of taken) {
        if (t.qty <= 0) continue;
        const { rows: [up] } = await db.query(
          "update products set quantity = quantity + $2 where id = $1 returning quantity", [t.product_id, t.qty]
        );
        if (up) {
          await db.query(
            `insert into stock_movements (product_id, change, quantity_after, reason, sale_id, note, user_id)
             values ($1,$2,$3,'void',$4,$5,$6)`,
            [t.product_id, t.qty, up.quantity, s.id, req.body.reason, req.user.id]
          );
        }
      }
    });
    const [sale] = await loadSales({ query }, "where s.id = $1", [req.params.id], { withReturns: true });
    res.json({ message: "Sale voided and stock restored", sale });
  }
);

// Return some or all items from a sale and refund the customer.
router.post(
  "/:id/returns",
  requireRole("manager"),
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    items: Joi.array().min(1).max(500).items(Joi.object({
      saleItemId: id.required(),
      quantity: Joi.number().integer().min(1).required(),
      restock: Joi.boolean().default(true),   // false for damaged goods
    })).required(),
    reason: text(300).min(1).required(),
    refundMethod: Joi.string().valid("Cash", "Card"),
  })),
  async (req, res) => {
    const b = req.body;
    const result = await tx(async (db) => {
      const { rows: [s] } = await db.query("select * from sales where id = $1 for update", [req.params.id]);
      if (!s) fail(404, "Sale not found");
      if (s.payment_status === "Voided") fail(409, "This sale was voided; nothing to return");
      const refundMethod = b.refundMethod || s.payment_method;

      const { rows: shiftRows } = await db.query("select id from shifts where user_id = $1 and closed_at is null", [req.user.id]);
      const shiftId = shiftRows[0]?.id || null;
      if (refundMethod === "Cash" && !shiftId) fail(409, "Open a shift before giving a cash refund (the cash comes from your drawer)", { code: "SHIFT_REQUIRED" });

      const { rows: items } = await db.query("select * from sale_items where sale_id = $1 for update", [s.id]);
      const byId = new Map(items.map((i) => [i.id, i]));
      const merged = new Map();
      for (const it of b.items) {
        const cur = merged.get(it.saleItemId);
        merged.set(it.saleItemId, { ...it, quantity: (cur ? cur.quantity : 0) + it.quantity });
      }

      const lines = [];
      for (const it of merged.values()) {
        const si = byId.get(it.saleItemId);
        if (!si) fail(400, "Item is not part of this sale");
        const left = si.quantity - si.returned_quantity;
        if (it.quantity > left) fail(400, `Only ${left} of "${si.name}" can still be returned`);
        lines.push({ si, quantity: it.quantity, restock: it.restock, amount: round2(unitRefund(s, si) * it.quantity) });
      }

      // Never refund more than was paid (rounding safety).
      const { rows: [{ refunded }] } = await db.query("select coalesce(sum(refund_amount),0) as refunded from returns where sale_id = $1", [s.id]);
      let refundAmount = round2(lines.reduce((t, l) => t + l.amount, 0));
      const allBack = items.every((i) => (i.quantity - i.returned_quantity) === (merged.get(i.id)?.quantity || 0));
      if (allBack || refundAmount > s.total_amount - refunded) refundAmount = round2(s.total_amount - refunded);

      const { rows: [ret] } = await db.query(
        `insert into returns (return_number, sale_id, user_id, shift_id, reason, refund_method, refund_amount)
         values ('RET-' || lpad(nextval('return_seq')::text, 6, '0'), $1,$2,$3,$4,$5,$6) returning *`,
        [s.id, req.user.id, shiftId, b.reason, refundMethod, refundAmount]
      );
      for (const l of lines) {
        await db.query("update sale_items set returned_quantity = returned_quantity + $2 where id = $1", [l.si.id, l.quantity]);
        await db.query(
          `insert into return_items (return_id, sale_item_id, product_id, name, quantity, amount, restocked) values ($1,$2,$3,$4,$5,$6,$7)`,
          [ret.id, l.si.id, l.si.product_id, l.si.name, l.quantity, l.amount, l.restock]
        );
        if (l.restock && l.si.product_id) {
          const { rows: [up] } = await db.query(
            "update products set quantity = quantity + $2 where id = $1 returning quantity", [l.si.product_id, l.quantity]
          );
          if (up) {
            await db.query(
              `insert into stock_movements (product_id, change, quantity_after, reason, sale_id, return_id, note, user_id)
               values ($1,$2,$3,'return',$4,$5,$6,$7)`,
              [l.si.product_id, l.quantity, up.quantity, s.id, ret.id, b.reason, req.user.id]
            );
          }
        }
      }
      return ret;
    });
    const [sale] = await loadSales({ query }, "where s.id = $1", [req.params.id], { withReturns: true });
    res.status(201).json({ message: `Return ${result.return_number} recorded`, returnNumber: result.return_number, refundAmount: result.refund_amount, sale });
  }
);

module.exports = router;
