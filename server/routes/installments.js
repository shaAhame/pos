// Installment plans (easy payment): schedule, collections, overdue.
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi, round2, money2 } = require("../lib/util");
const { Joi, validate, id, money, text } = require("../lib/validate");
const { fail } = require("../lib/errors");
const { canAccessLocation } = require("../lib/location");
const { getSettings } = require("../lib/settings");
const { recordPayment } = require("../lib/payments");
const { likeParam } = require("../lib/crud");

const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

// $1 business, $2 today
const SELECT = `
  select p.*, c.name as customer_name, c.contact_number as customer_phone, sa.invoice_number, l.name as location_name,
         d.total_due, d.total_paid, d.next_due_date, d.next_due_amount, d.overdue_amount, d.overdue_count
    from installment_plans p
    join customers c on c.id = p.customer_id
    join sales sa on sa.id = p.sale_id
    join locations l on l.id = p.location_id
    cross join lateral (
      select coalesce(sum(amount), 0) as total_due, coalesce(sum(paid), 0) as total_paid,
             min(due_date) filter (where paid < amount) as next_due_date,
             (select amount - paid from installment_dues x where x.plan_id = p.id and x.paid < x.amount order by seq limit 1) as next_due_amount,
             coalesce(sum(amount - paid) filter (where paid < amount and due_date < $2::date), 0) as overdue_amount,
             count(*) filter (where paid < amount and due_date < $2::date)::int as overdue_count
        from installment_dues where plan_id = p.id
    ) d
   where p.business_id = $1`;
const shape = (p) => ({
  _id: p.id, planNumber: p.plan_number, status: p.status, saleId: p.sale_id, invoiceNumber: p.invoice_number,
  customer: { _id: p.customer_id, name: p.customer_name, phone: p.customer_phone },
  location: { _id: p.location_id, name: p.location_name },
  saleTotal: p.sale_total, downPayment: p.down_payment, fee: p.fee, financed: p.financed, months: p.months, firstDue: p.first_due,
  outstanding: round2(p.total_due - p.total_paid), paid: round2(p.total_paid),
  nextDueDate: p.next_due_date, nextDueAmount: p.next_due_amount === null ? null : round2(p.next_due_amount),
  overdueAmount: round2(p.overdue_amount), overdueCount: p.overdue_count, createdAt: p.created_at, note: p.note,
});
const branchOf = (req) => (req.user.role === "owner" ? req.location?.id || null : req.user.locationId);

router.get(
  "/",
  validate(Joi.object({
    status: Joi.string().valid("active", "overdue", "due_soon", "completed", "cancelled", "all").default("active"),
    q: Joi.string().trim().allow("").max(80).default(""),
    customerId: id,
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const { timezone } = await getSettings(req.biz);
    const today = todayIn(timezone);
    const params = [req.biz, today];
    const where = [];
    const add = (fn, v) => { params.push(v); where.push(fn("$" + params.length)); };
    if (["active", "overdue", "due_soon"].includes(q.status)) where.push("p.status = 'active'");
    else if (q.status !== "all") add((x) => `p.status = ${x}`, q.status);
    if (q.status === "overdue") where.push("d.overdue_amount > 0");
    if (q.status === "due_soon") where.push("d.next_due_date <= $2::date + 7");
    if (q.q) add((x) => `(p.plan_number ilike ${x} or c.name ilike ${x} or c.contact_number ilike ${x} or sa.invoice_number ilike ${x})`, likeParam(q.q));
    if (q.customerId) add((x) => `p.customer_id = ${x}`, q.customerId);
    const loc = branchOf(req);
    if (loc) add((x) => `p.location_id = ${x}`, loc);
    const { rows } = await query(`${SELECT} ${where.length ? "and " + where.join(" and ") : ""} order by d.overdue_amount desc, d.next_due_date nulls last limit 500`, params);
    const plans = rows.map(shape);
    res.json({ plans, totals: { outstanding: round2(plans.reduce((t, p) => t + p.outstanding, 0)), overdue: round2(plans.reduce((t, p) => t + p.overdueAmount, 0)) } });
  }
);

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { timezone } = await getSettings(req.biz);
  const { rows } = await query(`${SELECT} and p.id = $3`, [req.biz, todayIn(timezone), req.params.id]);
  if (!rows[0] || !canAccessLocation(req.user, rows[0].location_id)) fail(404, "Plan not found");
  const { rows: dues } = await query("select id, seq, due_date, amount, paid, paid_at from installment_dues where plan_id = $1 order by seq", [req.params.id]);
  const { rows: pays } = await query(
    `select p.amount, p.method, p.kind, p.created_at, p.reference, u.first_name || ' ' || u.last_name as user_name
       from payments p left join users u on u.id = p.user_id where p.plan_id = $1 order by p.created_at`, [req.params.id]);
  res.json({ ...shape(rows[0]), dues: dues.map((d) => toApi(d)), payments: pays.map((p) => toApi(p)) });
});

// Collect a payment (applied to the oldest unpaid installment first).
router.post(
  "/:id/pay",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ amount: money.greater(0).required(), method: Joi.string().valid("Cash", "Card", "Bank").required(), note: text(200).allow("") })),
  async (req, res) => {
    const b = req.body;
    const result = await tx(async (db) => {
      const { rows: [plan] } = await db.query("select * from installment_plans where id = $1 and business_id = $2 for update", [req.params.id, req.biz]);
      if (!plan || !canAccessLocation(req.user, plan.location_id)) fail(404, "Plan not found");
      if (plan.status !== "active") fail(409, `This plan is ${plan.status}`);
      const { rows: shifts } = await db.query("select id, location_id from shifts where user_id = $1 and business_id = $2 and closed_at is null", [req.user.id, req.biz]);
      if (b.method === "Cash" && !shifts[0]) fail(409, "Open a shift to take cash (it goes into your drawer)", { code: "SHIFT_REQUIRED" });
      const { rows: dues } = await db.query("select * from installment_dues where plan_id = $1 and paid < amount order by seq for update", [plan.id]);
      const owed = round2(dues.reduce((t, d) => t + (d.amount - d.paid), 0));
      if (b.amount > owed + 0.005) fail(400, `Only ${money2(owed)} is still owed on this plan`);
      let left = b.amount;
      for (const d of dues) {
        if (left <= 0.005) break;
        const take = round2(Math.min(left, d.amount - d.paid));
        await db.query("update installment_dues set paid = paid + $2, paid_at = case when paid + $2 >= amount then now() else paid_at end where id = $1", [d.id, take]);
        left = round2(left - take);
      }
      await recordPayment(db, { biz: req.biz, locationId: shifts[0]?.location_id || plan.location_id, shiftId: shifts[0]?.id, userId: req.user.id,
        saleId: plan.sale_id, planId: plan.id, kind: "installment", method: b.method, amount: b.amount, reference: plan.plan_number });
      const remaining = round2(owed - b.amount);
      if (remaining <= 0.005) await db.query("update installment_plans set status = 'completed' where id = $1", [plan.id]);
      return { remaining, completed: remaining <= 0.005, planNumber: plan.plan_number };
    });
    res.json({ message: result.completed ? `${result.planNumber} fully paid` : `Payment recorded. ${money2(result.remaining)} still owed.`, ...result });
  }
);

module.exports = router;
