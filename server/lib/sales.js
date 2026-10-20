// Shared sale helpers: money maths and loading sales in the shape the app expects.
const { round2 } = require("./util");

// Same formula is used by the till (client) so the screen and the receipt always agree.
const computeTotals = (lines, discountPct, taxPct) => {
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const discountAmount = round2((subtotal * discountPct) / 100);
  const taxAmount = round2(((subtotal - discountAmount) * taxPct) / 100);
  const totalAmount = round2(subtotal - discountAmount + taxAmount);
  return { subtotal, discountAmount, taxAmount, totalAmount };
};

// What one unit of a sale line is worth after the sale's discount and tax (used for refunds).
const unitRefund = (sale, item) => (item.price * (1 - sale.discount / 100)) * (1 + sale.tax_rate / 100);

const SALE_SELECT = `
  select s.*,
         c.name as c_name, c.contact_number as c_contact, c.email as c_email, c.address as c_address,
         u.first_name as u_first, u.last_name as u_last,
         vb.first_name || ' ' || vb.last_name as voided_by_name,
         (select coalesce(sum(refund_amount), 0) from returns r where r.sale_id = s.id) as refunded_amount
    from sales s
    left join customers c on c.id = s.customer_id
    left join users u on u.id = s.cashier_id
    left join users vb on vb.id = s.voided_by`;

const shapeSale = (s, items = [], returns = []) => ({
  _id: s.id,
  invoiceNumber: s.invoice_number,
  customer: s.customer_id
    ? { _id: s.customer_id, name: s.c_name, contactNumber: s.c_contact, email: s.c_email, address: s.c_address }
    : null,
  customerName: s.customer_name,
  items: items.map((i) => ({
    _id: i.id, product: i.product_id, name: i.name, quantity: i.quantity, price: i.price, total: i.total,
    returnedQuantity: i.returned_quantity,
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
  refundedAmount: s.refunded_amount,
  returnStatus: !items.length ? undefined
    : items.every((i) => i.returned_quantity === i.quantity) ? "Returned"
    : items.some((i) => i.returned_quantity > 0) ? "Partially returned" : null,
  cashier: s.cashier_id ? { _id: s.cashier_id, firstName: s.u_first, lastName: s.u_last } : null,
  shiftId: s.shift_id,
  offline: s.offline,
  offlineNote: s.offline_note,
  voided: s.voided_at ? { at: s.voided_at, by: s.voided_by, byName: s.voided_by_name, reason: s.void_reason } : undefined,
  returns: returns.map((r) => ({
    _id: r.id, returnNumber: r.return_number, reason: r.reason, refundMethod: r.refund_method,
    refundAmount: r.refund_amount, createdAt: r.created_at, userName: r.user_name,
    items: (r.items || []).map((ri) => ({ name: ri.name, quantity: ri.quantity, amount: ri.amount, restocked: ri.restocked })),
  })),
  date: s.date,
});

// Load sales with their items (and, if withReturns, return records).
const loadSales = async (db, whereSql, params, { orderLimit = "order by s.date desc, s.invoice_number desc", withReturns = false } = {}) => {
  const { rows: sales } = await db.query(`${SALE_SELECT} ${whereSql} ${orderLimit}`, params);
  if (!sales.length) return [];
  const ids = sales.map((s) => s.id);
  const { rows: items } = await db.query(
    "select * from sale_items where sale_id = any($1::uuid[]) order by name, id", [ids]
  );
  let returns = [];
  if (withReturns) {
    ({ rows: returns } = await db.query(
      `select r.*, u.first_name || ' ' || u.last_name as user_name,
              (select json_agg(json_build_object('name', ri.name, 'quantity', ri.quantity, 'amount', ri.amount, 'restocked', ri.restocked))
                 from return_items ri where ri.return_id = r.id) as items
         from returns r left join users u on u.id = r.user_id
        where r.sale_id = any($1::uuid[]) order by r.created_at`,
      [ids]
    ));
  }
  return sales.map((s) => shapeSale(s, items.filter((i) => i.sale_id === s.id), returns.filter((r) => r.sale_id === s.id)));
};

module.exports = { computeTotals, unitRefund, loadSales };
