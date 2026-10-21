// Sale maths and loading sales in the shape the app expects.
const { round2 } = require("./util");

// Same formula as the till (client/src/lib/money.js) so screen and receipt always agree.
// lines: [{ price, quantity, discount }]  (discount = amount off that line)
const lineTotal = (l) => round2(l.price * l.quantity - (l.discount || 0));
const computeTotals = (lines, discountPct, taxPct) => {
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const discountAmount = round2((subtotal * discountPct) / 100);
  const taxAmount = round2(((subtotal - discountAmount) * taxPct) / 100);
  const totalAmount = round2(subtotal - discountAmount + taxAmount);
  return { subtotal, discountAmount, taxAmount, totalAmount };
};

// What one unit of a sale line is worth after line discount, sale discount and tax (used for refunds).
const unitRefund = (sale, item) => (Number(item.total) / item.quantity) * (1 - sale.discount / 100) * (1 + sale.tax_rate / 100);

const SALE_SELECT = `
  select s.*,
         c.name as c_name, c.contact_number as c_contact, c.email as c_email, c.address as c_address,
         u.first_name as u_first, u.last_name as u_last,
         vb.first_name || ' ' || vb.last_name as voided_by_name,
         ab.first_name || ' ' || ab.last_name as approved_by_name,
         lo.name as lo_name, lo.address as lo_address, lo.phone as lo_phone,
         (select coalesce(sum(refund_amount), 0) from returns r where r.sale_id = s.id) as refunded_amount
    from sales s
    left join customers c on c.id = s.customer_id
    left join users u on u.id = s.cashier_id
    left join users vb on vb.id = s.voided_by
    left join users ab on ab.id = s.approved_by
    left join locations lo on lo.id = s.location_id`;

const shapeSale = (s, x) => ({
  _id: s.id,
  invoiceNumber: s.invoice_number,
  customer: s.customer_id ? { _id: s.customer_id, name: s.c_name, contactNumber: s.c_contact, email: s.c_email, address: s.c_address } : null,
  customerName: s.customer_name,
  items: x.items.map((i) => ({
    _id: i.id, product: i.product_id, name: i.name, quantity: i.quantity, price: i.price, discount: i.discount, total: i.total,
    returnedQuantity: i.returned_quantity, warrantyUntil: i.warranty_until,
    serials: x.serials.filter((z) => z.sale_item_id === i.id).map((z) => ({ _id: z.serial_id, serial: z.serial, returned: z.returned })),
  })),
  subtotal: s.subtotal,
  discount: s.discount,
  discountAmount: s.discount_amount,
  taxRate: s.tax_rate,
  taxAmount: s.tax_amount,
  totalAmount: s.total_amount,
  amountTendered: s.amount_tendered,
  changeGiven: s.change_given,
  paymentStatus: s.payment_status,
  paymentMethod: s.payment_method,
  payments: x.payments.filter((p) => p.kind === "sale").map((p) => ({ method: p.method, amount: p.amount })),
  refundedAmount: s.refunded_amount,
  returnStatus: !x.items.length ? undefined
    : x.items.every((i) => i.returned_quantity === i.quantity) ? "Returned"
    : x.items.some((i) => i.returned_quantity > 0) ? "Partially returned" : null,
  cashier: s.cashier_id ? { _id: s.cashier_id, firstName: s.u_first, lastName: s.u_last } : null,
  approvedBy: s.approved_by ? s.approved_by_name : null,
  shiftId: s.shift_id,
  location: s.location_id ? { _id: s.location_id, name: s.lo_name, address: s.lo_address, phone: s.lo_phone } : null,
  offline: s.offline,
  offlineNote: s.offline_note,
  voided: s.voided_at ? { at: s.voided_at, by: s.voided_by, byName: s.voided_by_name, reason: s.void_reason } : undefined,
  tradeIn: x.tradeIns[0] ? { description: x.tradeIns[0].description, serial: x.tradeIns[0].serial, value: x.tradeIns[0].value, condition: x.tradeIns[0].condition } : null,
  installmentPlan: x.plans[0] ? { _id: x.plans[0].id, planNumber: x.plans[0].plan_number, months: x.plans[0].months, financed: x.plans[0].financed, fee: x.plans[0].fee, status: x.plans[0].status, firstDue: x.plans[0].first_due, monthly: x.plans[0].monthly } : null,
  returns: x.returns.map((r) => ({
    _id: r.id, returnNumber: r.return_number, reason: r.reason, refundMethod: r.refund_method,
    refundAmount: r.refund_amount, createdAt: r.created_at, userName: r.user_name,
    items: (r.items || []).map((ri) => ({ name: ri.name, quantity: ri.quantity, amount: ri.amount, restocked: ri.restocked })),
  })),
  date: s.date,
});

// Load sales (always within one business) with everything needed for the receipt.
const loadSales = async (db, biz, whereSql, params, { orderLimit = "order by s.date desc, s.invoice_number desc", full = false } = {}) => {
  const { rows: sales } = await db.query(`${SALE_SELECT} where s.business_id = $1 ${whereSql ? "and " + whereSql : ""} ${orderLimit}`, [biz, ...params]);
  if (!sales.length) return [];
  const ids = sales.map((s) => s.id);
  const one = async (sql) => (await db.query(sql, [ids])).rows;
  const items = await one("select * from sale_items where sale_id = any($1::uuid[]) order by name, id");
  const serials = await one(`select sis.* from sale_item_serials sis join sale_items i on i.id = sis.sale_item_id where i.sale_id = any($1::uuid[]) order by sis.serial`);
  const payments = await one("select sale_id, kind, method, amount from payments where sale_id = any($1::uuid[]) and kind = 'sale' order by created_at, method");
  const tradeIns = full ? await one("select * from trade_ins where sale_id = any($1::uuid[])") : [];
  const plans = full ? await one(`select p.*, (select amount from installment_dues d where d.plan_id = p.id order by seq limit 1) as monthly
                                    from installment_plans p where p.sale_id = any($1::uuid[])`) : [];
  const returns = full ? await one(
    `select r.*, u.first_name || ' ' || u.last_name as user_name,
            (select json_agg(json_build_object('name', ri.name, 'quantity', ri.quantity, 'amount', ri.amount, 'restocked', ri.restocked))
               from return_items ri where ri.return_id = r.id) as items
       from returns r left join users u on u.id = r.user_id
      where r.sale_id = any($1::uuid[]) order by r.created_at`) : [];
  const by = (arr, s) => arr.filter((r) => r.sale_id === s.id);
  return sales.map((s) => shapeSale(s, {
    items: by(items, s), serials: serials.filter((z) => by(items, s).some((i) => i.id === z.sale_item_id)),
    payments: by(payments, s), tradeIns: by(tradeIns, s), plans: by(plans, s), returns: by(returns, s),
  }));
};

module.exports = { computeTotals, lineTotal, unitRefund, loadSales };
