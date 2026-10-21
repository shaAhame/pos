// The payments ledger: every money movement in or out, signed (+ in, - out).
// Cash-ups are computed from it, so any new way of taking money just writes rows here.
const recordPayment = (db, p) =>
  db.query(
    `insert into payments (business_id, location_id, shift_id, user_id, sale_id, return_id, plan_id, order_id, kind, method, amount, reference)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [p.biz, p.locationId || null, p.shiftId || null, p.userId || null, p.saleId || null, p.returnId || null,
     p.planId || null, p.orderId || null, p.kind, p.method, p.amount, p.reference || null]
  );

// Money totals for one shift. Expected cash in the drawer = opening float + all cash in - all cash out.
const shiftMoney = async (db, shift) => {
  const { rows } = await db.query(
    `select kind, method, coalesce(sum(amount), 0) as amount, count(distinct coalesce(sale_id, plan_id, order_id, id))::int as n
       from payments where shift_id = $1 group by kind, method`,
    [shift.id]
  );
  const sum = (f) => rows.filter(f).reduce((t, r) => t + Number(r.amount), 0);
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const { rows: [c] } = await db.query(
    `select count(*) filter (where payment_status = 'Paid')::int as sales_count,
            count(*) filter (where payment_status = 'Voided')::int as void_count,
            coalesce(sum(total_amount) filter (where payment_status = 'Voided'), 0) as void_total,
            (select count(*)::int from returns where shift_id = $1) as return_count
       from sales where shift_id = $1`,
    [shift.id]
  );
  const cashSales = r2(sum((r) => r.method === "Cash" && (r.kind === "sale" || r.kind === "void")));
  const cashRefunds = r2(-sum((r) => r.method === "Cash" && r.kind === "refund"));
  const cashInstallments = r2(sum((r) => r.method === "Cash" && r.kind === "installment"));
  const cashDeposits = r2(sum((r) => r.method === "Cash" && (r.kind === "deposit" || r.kind === "deposit_refund")));
  return {
    salesCount: c.sales_count,
    voidCount: c.void_count,
    voidTotal: c.void_total,
    returnCount: c.return_count,
    cashSales,
    cardSales: r2(sum((r) => r.method === "Card" && (r.kind === "sale" || r.kind === "void"))),
    bankSales: r2(sum((r) => r.method === "Bank" && (r.kind === "sale" || r.kind === "void"))),
    totalSales: r2(sum((r) => r.kind === "sale" || r.kind === "void")),   // full value of sales, however paid
    cashRefunds,
    cardRefunds: r2(-sum((r) => r.method !== "Cash" && r.method !== "Credit" && r.kind === "refund")),
    cashInstallments,
    cashDeposits,
    otherCollections: r2(sum((r) => r.method !== "Cash" && ["installment", "deposit", "deposit_refund"].includes(r.kind))),
    expectedCash: r2(Number(shift.opening_float) + sum((r) => r.method === "Cash")),
  };
};

module.exports = { recordPayment, shiftMoney };
