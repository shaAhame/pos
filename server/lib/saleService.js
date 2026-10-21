// The sale engine: used by the till, repairs (collect & pay) and advance orders (complete).
// Everything happens inside the caller's transaction (db), so a sale is saved completely or not at all.
const bcrypt = require("bcrypt");
const { round2 } = require("./util");
const { fail } = require("./errors");
const { computeTotals, lineTotal, unitRefund } = require("./sales");
const { moveStock, noteMovement, takeStock } = require("./stock");
const { nextNumber } = require("./counters");
const { recordPayment } = require("./payments");
const serialsLib = require("./serials");

const EPS = 0.005;
const addMonths = (date, n) => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
};
const isoDay = (d) => d.toISOString().slice(0, 10);

// Check a manager's approval PIN (for discounts above the cashier limit).
const checkApproval = async (db, ctx, approval) => {
  if (!approval?.userId || !approval?.pin) return null;
  const { rows } = await db.query(
    "select id, role, location_id, approval_pin, active from users where id = $1 and business_id = $2",
    [approval.userId, ctx.biz]
  );
  const m = rows[0];
  if (!m || !m.active || !["manager", "owner"].includes(m.role) || !m.approval_pin) return null;
  if (m.role === "manager" && m.location_id !== ctx.locationId) return null;
  return (await bcrypt.compare(String(approval.pin), m.approval_pin)) ? m.id : null;
};

/**
 * input: {
 *   clientRef, items: [{ product, quantity, discount, serials, price?, name? }], serviceLines: [{ name, price, quantity }],
 *   customer, customerName, discount, taxRate, payments: [{ method, amount }], cashTendered,
 *   paymentMethod, amountTendered (old tills), tradeIn: { description, serial, condition, value, productId },
 *   installment: { months, firstDue, fee }, approval: { userId, pin }, offline, createdAt, shiftId
 * }
 * internal (server only): deposit: { orderId, amount }
 */
const createSale = async (db, ctx, b) => {
  const { biz, user, features, settings } = ctx;
  const offline = !!b.offline;
  const notes = [];

  // ---- shift and branch ----
  let shift = null;
  if (offline && b.shiftId) {
    shift = (await db.query("select id, location_id from shifts where id = $1 and user_id = $2 and business_id = $3", [b.shiftId, user.id, biz])).rows[0] || null;
  }
  if (!shift) {
    shift = (await db.query("select id, location_id from shifts where user_id = $1 and business_id = $2 and closed_at is null", [user.id, biz])).rows[0] || null;
    if (!shift && !offline) fail(409, "Open a shift before selling", { code: "SHIFT_REQUIRED" });
    if (!shift) notes.push("No open shift when synced");
  }
  let locationId = shift?.location_id || user.locationId || ctx.location?.id || null;
  if (!locationId) {
    const { rows } = await db.query("select id from locations where business_id = $1 and active and type = 'store' order by created_at limit 1", [biz]);
    if (!rows[0]) fail(400, "This business has no shop branch");
    locationId = rows[0].id;
  }
  const shiftId = shift?.id || null;

  // ---- customer ----
  let customerId = null;
  let customerName = (b.customerName || "").trim() || "Walk-in Customer";
  if (b.customer) {
    const { rows } = await db.query("select id, name from customers where id = $1 and business_id = $2", [b.customer, biz]);
    if (rows[0]) { customerId = rows[0].id; customerName = rows[0].name; }
    else if (!offline) fail(400, "Customer not found");
  }

  // ---- product lines (lock this branch's stock rows in a fixed order) ----
  const wanted = new Map();
  for (const it of b.items || []) {
    const cur = wanted.get(it.product);
    if (cur) {
      cur.quantity += it.quantity;
      cur.discount = round2((cur.discount || 0) + (it.discount || 0));
      cur.serials = [...(cur.serials || []), ...(it.serials || [])];
    } else wanted.set(it.product, { ...it, discount: it.discount || 0, serials: [...(it.serials || [])] });
  }
  const ids = [...wanted.keys()].sort();
  if (ids.length) {
    await db.query(
      `insert into product_stock (business_id, product_id, location_id, quantity)
         select $3, id, $2, 0 from products where id = any($1::uuid[]) and business_id = $3 on conflict do nothing`,
      [ids, locationId, biz]
    );
  }
  const { rows: prods } = ids.length ? await db.query(
    `select p.*, ps.quantity from product_stock ps join products p on p.id = ps.product_id
      where ps.business_id = $3 and ps.location_id = $2 and ps.product_id = any($1::uuid[])
      order by ps.product_id for update of ps`,
    [ids, locationId, biz]
  ) : { rows: [] };
  const byId = new Map(prods.map((p) => [p.id, p]));

  const lines = [];
  for (const pid of ids) {
    const want = wanted.get(pid);
    const p = byId.get(pid);
    if (want.discount > 0 && !features.lineDiscounts) fail(400, "Item discounts aren't switched on for this business");
    if (!p) {
      if (!offline) fail(409, "A product in the cart no longer exists", { productId: pid });
      if (want.price === undefined || !want.name) fail(400, "Offline sale line is missing name or price");
      notes.push(`"${want.name}" not found in products; stock not changed`);
      lines.push({ productId: null, name: want.name, quantity: want.quantity, price: want.price, discount: want.discount, cost: null, deduct: 0, serials: [] });
      continue;
    }
    if (!offline) {
      if (!p.active) fail(409, `"${p.name}" is no longer sold`, { productId: pid });
      if (p.quantity < want.quantity) fail(409, `Not enough stock for "${p.name}" (available: ${p.quantity}, requested: ${want.quantity})`, { productId: pid, available: p.quantity });
    }
    let price = p.price;
    if (offline && want.price !== undefined) {
      if (want.price !== p.price) notes.push(`"${p.name}" sold at ${want.price} offline (current price ${p.price})`);
      price = want.price;
    }
    // serial-tracked products: every unit sold must be identified
    let units = [];
    const tracked = p.track_serials && features.serials;
    if (tracked) {
      if (!offline && want.serials.length !== want.quantity) {
        fail(400, `Scan the serial / IMEI of each "${p.name}" sold (${want.serials.length} of ${want.quantity} scanned)`, { code: "SERIALS_REQUIRED", productId: pid });
      }
      if (!offline) units = await serialsLib.lockInStock(db, biz, pid, locationId, want.serials, p.name);
      else {
        for (const s of want.serials) {
          const n = serialsLib.norm(s);
          const { rows } = await db.query("select * from serials where business_id = $1 and upper(serial) = $2 for update", [biz, n]);
          if (rows[0] && rows[0].product_id === pid && rows[0].status === "in_stock") units.push(rows[0]);
          else {
            notes.push(`Serial ${n} for "${p.name}" wasn't in stock here when synced`);
            if (!rows[0]) units.push((await serialsLib.addUnits(db, biz, { productId: pid, locationId, serials: [n], event: "created at offline sync", userId: user.id }))[0]);
          }
        }
      }
    }
    const disc = round2(want.discount || 0);
    if (disc > price * want.quantity) fail(400, `Discount on "${p.name}" is more than its price`);
    const deduct = Math.min(want.quantity, p.quantity);
    if (deduct < want.quantity) notes.push(`"${p.name}": sold ${want.quantity} but only ${p.quantity} in stock`);
    const warrantyUntil = features.warranty && p.warranty_months > 0 ? isoDay(addMonths(new Date(), p.warranty_months)) : null;
    lines.push({ productId: p.id, name: p.variant ? `${p.name} ${p.variant}` : p.name, quantity: want.quantity, price, discount: disc,
      cost: p.cost_price, deduct, shortfall: want.quantity - deduct, units, warrantyUntil });
  }
  for (const s of b.serviceLines || []) {
    lines.push({ productId: null, service: true, name: s.name, quantity: s.quantity || 1, price: s.price, discount: 0, cost: null, deduct: 0, units: [] });
  }
  if (!lines.length) fail(400, "Cart is empty");
  for (const l of lines) l.total = lineTotal(l);
  const t = computeTotals(lines, b.discount || 0, b.taxRate || 0);

  // ---- discount approval ----
  let approvedBy = null;
  const gross = round2(lines.reduce((s, l) => s + l.price * l.quantity, 0));
  const discountPct = gross > 0 ? ((gross - t.subtotal + t.discountAmount) / gross) * 100 : 0;
  if (user.role === "cashier" && discountPct > settings.maxCashierDiscount + 1e-9) {
    approvedBy = await checkApproval(db, { biz, locationId }, b.approval);
    if (!approvedBy) {
      if (!offline) fail(403, `Discounts above ${settings.maxCashierDiscount}% need a manager's approval`, { code: "APPROVAL_REQUIRED", discountPct: round2(discountPct) });
      notes.push(`Discount ${round2(discountPct)}% is above the cashier limit of ${settings.maxCashierDiscount}%`);
    }
  }

  // ---- payments ----
  let pays = [];
  let cashTendered = b.cashTendered ?? null;
  if (Array.isArray(b.payments) && b.payments.length) pays = b.payments.map((p) => ({ method: p.method, amount: round2(p.amount) }));
  else if (b.paymentMethod) {                // older tills: one method for the whole amount
    pays = [{ method: b.paymentMethod, amount: t.totalAmount }];
    if (b.paymentMethod === "Cash" && b.amountTendered != null) cashTendered = b.amountTendered;
  }
  pays = pays.filter((p) => p.amount > 0);
  if (pays.filter((p) => ["Cash", "Card", "Bank"].includes(p.method)).length > 1 && !features.splitPayments) fail(400, "Split payments aren't switched on for this business");

  let tradeIn = null;
  if (b.tradeIn) {
    if (!features.tradeIns) fail(400, "Trade-ins aren't switched on for this business");
    tradeIn = b.tradeIn;
    pays.push({ method: "TradeIn", amount: round2(tradeIn.value) });
  }
  if (b.deposit) pays.push({ method: "Deposit", amount: round2(b.deposit.amount) });

  const paidNow = round2(pays.reduce((s, p) => s + p.amount, 0));
  let credit = 0;
  if (b.installment) {
    if (!features.installments) fail(400, "Installments aren't switched on for this business");
    if (!customerId) fail(400, "Choose a registered customer for an installment sale");
    credit = round2(t.totalAmount - paidNow);
    if (credit <= 0) fail(400, "Nothing is left to pay in installments");
    pays.push({ method: "Credit", amount: credit });
  }
  const sumPays = round2(pays.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(sumPays - t.totalAmount) > EPS) {
    if (!offline) fail(400, `Payments add up to ${sumPays} but the total is ${t.totalAmount}`, { code: "PAYMENT_MISMATCH", total: t.totalAmount });
    notes.push(`Payments (${sumPays}) didn't match the total (${t.totalAmount})`);
  }
  const cashPaid = round2(pays.filter((p) => p.method === "Cash").reduce((s, p) => s + p.amount, 0));
  let change = null;
  if (cashTendered != null && cashPaid > 0) {
    if (cashTendered + EPS < cashPaid) {
      if (!offline) fail(400, `Cash received (${cashTendered}) is less than the cash part (${cashPaid})`);
    } else change = round2(cashTendered - cashPaid);
  }
  const methods = [...new Set(pays.map((p) => p.method))];
  const summary = credit > 0 ? "Installment" : methods.length === 1 && ["Cash", "Card", "Bank"].includes(methods[0]) ? methods[0] : methods.length ? "Split" : "Cash";

  // ---- when ----
  let date = new Date();
  if (offline && b.createdAt) {
    const ts = new Date(b.createdAt);
    const age = Date.now() - ts.getTime();
    if (age > -5 * 60e3 && age < 30 * 24 * 3600e3) date = ts;
    else notes.push(`Original time ${ts.toISOString()} looked wrong; using sync time`);
  }

  // ---- write ----
  const invoice = await nextNumber(db, biz, "invoice");
  const { rows: [sale] } = await db.query(
    `insert into sales (business_id, invoice_number, client_ref, customer_id, customer_name, subtotal, discount, discount_amount,
                        tax_rate, tax_amount, total_amount, payment_status, payment_method, amount_tendered, change_given,
                        cashier_id, shift_id, offline, offline_note, synced_at, date, location_id, approved_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Paid',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) returning id`,
    [biz, invoice, b.clientRef || null, customerId, customerName, t.subtotal, b.discount || 0, t.discountAmount, b.taxRate || 0,
     t.taxAmount, t.totalAmount, summary, cashTendered, change, user.id, shiftId, offline, notes.length ? notes.join("; ") : null,
     offline ? new Date() : null, date, locationId, approvedBy]
  );

  for (const l of lines) {
    const { rows: [si] } = await db.query(
      `insert into sale_items (sale_id, product_id, name, quantity, price, discount, total, cost_price, warranty_until)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [sale.id, l.productId, l.name, l.quantity, l.price, l.discount, l.total, l.cost, l.warrantyUntil || null]
    );
    for (const u of l.units || []) {
      await serialsLib.setStatus(db, biz, u.id, "sold", { locationId, event: "sold", ref: invoice, userId: user.id,
        extra: { sale_id: sale.id, sold_at: date, warranty_until: l.warrantyUntil || null } });
      await db.query("insert into sale_item_serials (sale_item_id, serial_id, serial) values ($1,$2,$3)", [si.id, u.id, u.serial]);
    }
    if (!l.productId) continue;
    if (l.deduct > 0) await moveStock(db, { biz, productId: l.productId, locationId, change: -l.deduct, reason: "sale", saleId: sale.id, userId: user.id });
    if (l.shortfall > 0) {
      await noteMovement(db, { biz, productId: l.productId, locationId, reason: "offline_shortfall", saleId: sale.id, userId: user.id,
        note: `Sold ${l.shortfall} more than recorded stock while offline - recount this product` });
    }
  }

  for (const p of pays) {
    await recordPayment(db, { biz, locationId, shiftId, userId: user.id, saleId: sale.id, kind: "sale", method: p.method, amount: p.amount,
      reference: invoice, orderId: p.method === "Deposit" ? b.deposit?.orderId : null });
  }

  if (tradeIn) {
    let productId = null, serialId = null;
    if (tradeIn.productId) {
      const { rows } = await db.query("select id, name, track_serials from products where id = $1 and business_id = $2", [tradeIn.productId, biz]);
      if (!rows[0]) fail(400, "Trade-in product not found");
      productId = rows[0].id;
      await moveStock(db, { biz, productId, locationId, change: 1, reason: "trade_in", saleId: sale.id, unitCost: tradeIn.value, note: tradeIn.description, userId: user.id });
      if (rows[0].track_serials && features.serials) {
        if (!tradeIn.serial) fail(400, "Enter the trade-in item's serial / IMEI");
        serialId = (await serialsLib.addUnits(db, biz, { productId, locationId, serials: [tradeIn.serial], cost: tradeIn.value, event: "traded in", ref: invoice, userId: user.id }))[0].id;
      }
    }
    await db.query(
      `insert into trade_ins (business_id, sale_id, description, serial, condition, value, product_id, serial_id, user_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [biz, sale.id, tradeIn.description, tradeIn.serial || null, tradeIn.condition || "", tradeIn.value, productId, serialId, user.id]
    );
  }

  if (credit > 0) {
    const fee = round2(b.installment.fee || 0);
    const financed = round2(credit + fee);
    const months = b.installment.months;
    const first = b.installment.firstDue ? new Date(b.installment.firstDue + "T00:00:00Z") : addMonths(date, 1);
    const planNumber = await nextNumber(db, biz, "plan");
    const { rows: [plan] } = await db.query(
      `insert into installment_plans (business_id, plan_number, sale_id, customer_id, location_id, sale_total, down_payment, fee, financed, months, first_due, created_by, note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
      [biz, planNumber, sale.id, customerId, locationId, t.totalAmount, round2(t.totalAmount - credit), fee, financed, months, isoDay(first), user.id, b.installment.note || null]
    );
    const each = Math.floor((financed / months) * 100) / 100;
    for (let i = 0; i < months; i++) {
      const amount = i === months - 1 ? round2(financed - each * (months - 1)) : each;
      await db.query("insert into installment_dues (plan_id, seq, due_date, amount) values ($1,$2,$3,$4)", [plan.id, i + 1, isoDay(addMonths(first, i)), amount]);
    }
  }

  return { saleId: sale.id, invoiceNumber: invoice, locationId, shiftId };
};

// ---------- void ----------
const voidSale = async (db, ctx, saleId, reason) => {
  const { biz, user } = ctx;
  const { rows: [s] } = await db.query(
    `select s.*, sh.closed_at as shift_closed_at from sales s left join shifts sh on sh.id = s.shift_id
      where s.id = $1 and s.business_id = $2 for update of s`,
    [saleId, biz]
  );
  if (!s) fail(404, "Sale not found");
  if (user.role !== "owner" && user.locationId !== s.location_id) fail(403, "You can only void sales in your own branch");
  if (s.payment_status === "Voided") fail(409, "Sale is already voided");
  if (s.shift_closed_at) fail(409, "This sale's shift is already closed. Use a return instead.");
  if (!s.shift_id && Date.now() - new Date(s.date).getTime() > 24 * 3600e3) fail(409, "Sales older than a day can't be voided. Use a return instead.");
  const { rows: [{ n }] } = await db.query("select count(*)::int n from returns where sale_id = $1", [s.id]);
  if (n > 0) fail(409, "This sale has returns, so it can't be voided");
  const { rows: plans } = await db.query("select * from installment_plans where sale_id = $1 for update", [s.id]);
  for (const p of plans) {
    const { rows: [{ c }] } = await db.query("select count(*)::int c from payments where plan_id = $1 and kind = 'installment'", [p.id]);
    if (c > 0) fail(409, "Installments have already been paid on this sale. Use a return instead.");
    await db.query("update installment_plans set status = 'cancelled' where id = $1", [p.id]);
  }

  await db.query("update sales set payment_status = 'Voided', voided_at = now(), voided_by = $2, void_reason = $3 where id = $1", [s.id, user.id, reason]);

  // stock back exactly where it was taken from
  const { rows: taken } = await db.query(
    `select product_id, location_id, -sum(change)::int as qty from stock_movements
      where sale_id = $1 and business_id = $2 and reason = 'sale' group by product_id, location_id order by product_id`,
    [s.id, biz]
  );
  for (const t of taken) if (t.qty > 0) await moveStock(db, { biz, productId: t.product_id, locationId: t.location_id, change: t.qty, reason: "void", saleId: s.id, note: reason, userId: user.id });
  // units back on the shelf
  const { rows: units } = await db.query(
    `select sis.serial_id from sale_item_serials sis join sale_items i on i.id = sis.sale_item_id where i.sale_id = $1 and not sis.returned`, [s.id]
  );
  for (const u of units) await serialsLib.setStatus(db, biz, u.serial_id, "in_stock", { locationId: s.location_id, event: "sale voided", ref: s.invoice_number, userId: user.id, extra: { sale_id: null, sold_at: null, warranty_until: null } });
  // a traded-in item that went into stock comes back out
  const { rows: tis } = await db.query("select * from trade_ins where sale_id = $1", [s.id]);
  for (const ti of tis) {
    if (!ti.product_id) continue;
    if (ti.serial_id) {
      const { rows: [u] } = await db.query("select status from serials where id = $1", [ti.serial_id]);
      if (u?.status !== "in_stock") fail(409, "The traded-in item has already been sold, so this sale can't be voided");
      await serialsLib.setStatus(db, biz, ti.serial_id, "written_off", { event: "trade-in reversed", ref: s.invoice_number, userId: user.id });
    }
    await takeStock(db, { biz, productId: ti.product_id, locationId: s.location_id, quantity: 1, reason: "void", saleId: s.id, note: "Trade-in reversed", userId: user.id }, "traded-in item");
  }
  // money: reverse every payment of the sale
  const { rows: pays } = await db.query("select method, sum(amount) as amount from payments where sale_id = $1 and kind = 'sale' group by method", [s.id]);
  for (const p of pays) {
    await recordPayment(db, { biz, locationId: s.location_id, shiftId: s.shift_id, userId: user.id, saleId: s.id, kind: "void", method: p.method, amount: -p.amount, reference: s.invoice_number });
  }
  // an order's deposit is no longer used: the order goes back to "ready"
  await db.query("update orders set status = 'ready', sale_id = null, completed_at = null where sale_id = $1 and business_id = $2", [s.id, biz]);
  return s;
};

// ---------- returns ----------
const returnItems = async (db, ctx, saleId, b) => {
  const { biz, user, features } = ctx;
  const { rows: [s] } = await db.query("select * from sales where id = $1 and business_id = $2 for update", [saleId, biz]);
  if (!s) fail(404, "Sale not found");
  if (user.role !== "owner" && user.locationId !== s.location_id) fail(403, "You can only take returns for your own branch's sales");
  if (s.payment_status === "Voided") fail(409, "This sale was voided; nothing to return");

  const { rows: [plan] } = await db.query("select * from installment_plans where sale_id = $1 and status = 'active' for update", [s.id]);
  const refundMethod = b.refundMethod || (plan ? "Credit" : s.payment_method === "Card" || s.payment_method === "Bank" ? s.payment_method : "Cash");
  if (refundMethod === "Credit" && !plan) fail(400, "Only installment sales can be refunded against the remaining balance");

  const { rows: shiftRows } = await db.query("select id, location_id from shifts where user_id = $1 and business_id = $2 and closed_at is null", [user.id, biz]);
  const shiftId = shiftRows[0]?.id || null;
  const returnLocation = shiftRows[0]?.location_id || (user.role === "owner" && ctx.location?.type === "store" ? ctx.location.id : null) || s.location_id;
  if (refundMethod === "Cash" && !shiftId) fail(409, "Open a shift before giving a cash refund (the cash comes from your drawer)", { code: "SHIFT_REQUIRED" });

  const { rows: items } = await db.query("select * from sale_items where sale_id = $1 for update", [s.id]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const merged = new Map();
  for (const it of b.items) {
    const cur = merged.get(it.saleItemId);
    merged.set(it.saleItemId, cur ? { ...cur, quantity: cur.quantity + it.quantity, serials: [...(cur.serials || []), ...(it.serials || [])] } : { ...it, serials: [...(it.serials || [])] });
  }

  const lines = [];
  for (const it of merged.values()) {
    const si = byId.get(it.saleItemId);
    if (!si) fail(400, "Item is not part of this sale");
    const left = si.quantity - si.returned_quantity;
    if (it.quantity > left) fail(400, `Only ${left} of "${si.name}" can still be returned`);
    const { rows: siSerials } = await db.query("select * from sale_item_serials where sale_item_id = $1 and not returned", [si.id]);
    let units = [];
    if (siSerials.length) {
      const chosen = (it.serials || []).map(serialsLib.norm);
      if (chosen.length !== it.quantity) fail(400, `Choose which serial numbers of "${si.name}" are coming back (${chosen.length} of ${it.quantity})`, { code: "SERIALS_REQUIRED" });
      units = chosen.map((c) => siSerials.find((x) => serialsLib.norm(x.serial) === c) || fail(400, `Serial ${c} wasn't sold on this receipt`));
    }
    lines.push({ si, quantity: it.quantity, restock: it.restock, units, amount: round2(unitRefund(s, si) * it.quantity) });
  }

  const { rows: [{ refunded }] } = await db.query("select coalesce(sum(refund_amount),0) as refunded from returns where sale_id = $1", [s.id]);
  let refundAmount = round2(lines.reduce((t, l) => t + l.amount, 0));
  const allBack = items.every((i) => (i.quantity - i.returned_quantity) === (merged.get(i.id)?.quantity || 0));
  if (allBack || refundAmount > s.total_amount - refunded) refundAmount = round2(s.total_amount - refunded);

  // installment sale: reduce what the customer still owes (latest dues first)
  if (refundMethod === "Credit") {
    const { rows: dues } = await db.query("select * from installment_dues where plan_id = $1 order by seq desc for update", [plan.id]);
    const owed = round2(dues.reduce((t, d) => t + (d.amount - d.paid), 0));
    if (refundAmount > owed + EPS) fail(400, `Only ${owed} is still owed on ${plan.plan_number}. Refund the rest in cash or by card.`);
    let left = refundAmount;
    for (const d of dues) {
      if (left <= EPS) break;
      const open = round2(d.amount - d.paid);
      const cut = Math.min(open, left);
      if (cut <= 0) continue;
      const newAmount = round2(d.amount - cut);
      if (newAmount <= EPS) await db.query("delete from installment_dues where id = $1", [d.id]);
      else await db.query("update installment_dues set amount = $2 where id = $1", [d.id, newAmount]);
      left = round2(left - cut);
    }
    const { rows: [{ open }] } = await db.query("select count(*)::int open from installment_dues where plan_id = $1 and paid < amount", [plan.id]);
    if (open === 0) await db.query("update installment_plans set status = 'completed' where id = $1", [plan.id]);
  }

  const returnNumber = await nextNumber(db, biz, "return");
  const { rows: [ret] } = await db.query(
    `insert into returns (business_id, return_number, sale_id, user_id, shift_id, reason, refund_method, refund_amount, location_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [biz, returnNumber, s.id, user.id, shiftId, b.reason, refundMethod, refundAmount, returnLocation]
  );
  for (const l of lines) {
    await db.query("update sale_items set returned_quantity = returned_quantity + $2 where id = $1", [l.si.id, l.quantity]);
    await db.query(
      `insert into return_items (return_id, sale_item_id, product_id, name, quantity, amount, restocked) values ($1,$2,$3,$4,$5,$6,$7)`,
      [ret.id, l.si.id, l.si.product_id, l.si.name, l.quantity, l.amount, l.restock]
    );
    for (const u of l.units) {
      await db.query("update sale_item_serials set returned = true where sale_item_id = $1 and serial_id = $2", [l.si.id, u.serial_id]);
      await serialsLib.setStatus(db, biz, u.serial_id, l.restock ? "in_stock" : "defective", {
        locationId: returnLocation, event: l.restock ? "returned to stock" : "returned faulty", ref: returnNumber, note: b.reason, userId: user.id,
        extra: { sale_id: null, sold_at: null },
      });
    }
    if (l.restock && l.si.product_id) {
      await moveStock(db, { biz, productId: l.si.product_id, locationId: returnLocation, change: l.quantity, reason: "return", saleId: s.id, returnId: ret.id, note: b.reason, userId: user.id });
    }
  }
  await recordPayment(db, { biz, locationId: returnLocation, shiftId, userId: user.id, saleId: s.id, returnId: ret.id, kind: "refund",
    method: refundMethod, amount: -refundAmount, reference: returnNumber });
  return ret;
};

module.exports = { createSale, voidSale, returnItems, addMonths, isoDay };
