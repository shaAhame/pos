// Till shifts: open with a cash float, close with a cash count (end-of-day cash-up).
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { round2 } = require("../lib/util");
const { Joi, validate, id, money, text, day } = require("../lib/validate");
const { atLeast } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { getSettings } = require("../lib/settings");
const { dayRange } = require("../lib/dates");
const { requireOneLocation, canAccessLocation } = require("../lib/location");

// Money totals for one shift. Expected cash = float + cash sales - cash refunds.
const shiftSummary = async (db, shift) => {
  const { rows: [s] } = await db.query(
    `select
       count(*) filter (where payment_status = 'Paid')::int                                         as sales_count,
       coalesce(sum(total_amount) filter (where payment_status = 'Paid' and payment_method = 'Cash'), 0) as cash_sales,
       coalesce(sum(total_amount) filter (where payment_status = 'Paid' and payment_method = 'Card'), 0) as card_sales,
       count(*) filter (where payment_status = 'Voided')::int                                       as void_count,
       coalesce(sum(total_amount) filter (where payment_status = 'Voided'), 0)                      as void_total
     from sales where shift_id = $1`,
    [shift.id]
  );
  const { rows: [r] } = await db.query(
    `select coalesce(sum(refund_amount) filter (where refund_method = 'Cash'), 0) as cash_refunds,
            coalesce(sum(refund_amount) filter (where refund_method = 'Card'), 0) as card_refunds,
            count(*)::int as return_count
       from returns where shift_id = $1`,
    [shift.id]
  );
  const expectedCash = round2(shift.opening_float + s.cash_sales - r.cash_refunds);
  return {
    salesCount: s.sales_count,
    cashSales: s.cash_sales,
    cardSales: s.card_sales,
    totalSales: round2(s.cash_sales + s.card_sales),
    voidCount: s.void_count,
    voidTotal: s.void_total,
    returnCount: r.return_count,
    cashRefunds: r.cash_refunds,
    cardRefunds: r.card_refunds,
    expectedCash,
  };
};

const shape = (row) => row && ({
  _id: row.id,
  user: { _id: row.user_id, name: row.user_name },
  openedAt: row.opened_at,
  openingFloat: row.opening_float,
  closedAt: row.closed_at,
  closedBy: row.closed_by ? { _id: row.closed_by, name: row.closed_by_name } : null,
  countedCash: row.counted_cash,
  expectedCash: row.expected_cash,
  variance: row.variance,
  note: row.note,
  status: row.closed_at ? "closed" : "open",
  location: row.location_id ? { _id: row.location_id, name: row.location_name } : null,
});

const SELECT = `select sh.*, u.first_name || ' ' || u.last_name as user_name,
                       cb.first_name || ' ' || cb.last_name as closed_by_name, lo.name as location_name
                  from shifts sh
                  join users u on u.id = sh.user_id
                  left join users cb on cb.id = sh.closed_by
                  left join locations lo on lo.id = sh.location_id`;

const loadShift = async (db, shiftId) => (await db.query(`${SELECT} where sh.id = $1`, [shiftId])).rows[0];

// My open shift (or null)
router.get("/current", async (req, res) => {
  const { rows } = await query(`${SELECT} where sh.user_id = $1 and sh.closed_at is null`, [req.user.id]);
  if (!rows[0]) return res.json(null);
  res.json({ ...shape(rows[0]), summary: await shiftSummary({ query }, rows[0]) });
});

router.post(
  "/open",
  validate(Joi.object({ openingFloat: money.default(0) })),
  async (req, res) => {
    const loc = await requireOneLocation(req, { storeOnly: true });
    const { rows } = await query(
      "insert into shifts (user_id, opening_float, location_id) values ($1, $2, $3) returning id",
      [req.user.id, req.body.openingFloat, loc.id]
    ).catch((e) => {
      if (e.code === "23505") fail(409, "You already have an open shift");
      throw e;
    });
    const s = await loadShift({ query }, rows[0].id);
    res.status(201).json({ ...shape(s), summary: await shiftSummary({ query }, s) });
  }
);

router.post(
  "/:id/close",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ countedCash: money.required(), note: text(500).allow("").default("") })),
  async (req, res) => {
    const result = await tx(async (db) => {
      const { rows } = await db.query("select * from shifts where id = $1 for update", [req.params.id]);
      const sh = rows[0];
      if (!sh) fail(404, "Shift not found");
      if (sh.user_id !== req.user.id && !atLeast(req.user, "manager")) fail(403, "You can only close your own shift");
      if (sh.user_id !== req.user.id && !canAccessLocation(req.user, sh.location_id)) fail(403, "You can only close shifts in your own branch");
      if (sh.closed_at) fail(409, "This shift is already closed");
      const summary = await shiftSummary(db, sh);
      const variance = round2(req.body.countedCash - summary.expectedCash);
      await db.query(
        `update shifts set closed_at = now(), closed_by = $2, counted_cash = $3, expected_cash = $4, variance = $5, note = $6
          where id = $1`,
        [sh.id, req.user.id, req.body.countedCash, summary.expectedCash, variance, req.body.note || null]
      );
      return { ...shape(await loadShift(db, sh.id)), summary };
    });
    res.json(result);
  }
);

// Shift list. Cashiers see their own; managers see everyone's.
router.get(
  "/",
  validate(Joi.object({
    from: day, to: day,
    status: Joi.string().valid("open", "closed", "all").default("all"),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(500).default(30),
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const { timezone } = await getSettings();
    const where = [], params = [];
    const r = dayRange("sh.opened_at", q.from, q.to, timezone, 1);
    if (r.sql) { where.push(r.sql); params.push(...r.params); }
    if (req.user.role === "cashier") { params.push(req.user.id); where.push(`sh.user_id = $${params.length}`); }
    else if (req.user.role === "manager") { params.push(req.user.locationId); where.push(`sh.location_id = $${params.length}`); }
    else if (req.location) { params.push(req.location.id); where.push(`sh.location_id = $${params.length}`); }
    if (q.status === "open") where.push("sh.closed_at is null");
    if (q.status === "closed") where.push("sh.closed_at is not null");
    const w = where.length ? "where " + where.join(" and ") : "";
    const total = (await query(`select count(*)::int n from shifts sh ${w}`, params)).rows[0].n;
    const { rows } = await query(`${SELECT} ${w} order by sh.opened_at desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`, params);
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, shifts: rows.map(shape) });
  }
);

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const s = await loadShift({ query }, req.params.id);
  if (!s) fail(404, "Shift not found");
  if (s.user_id !== req.user.id && !atLeast(req.user, "manager")) fail(403, "You can only view your own shifts");
  if (s.user_id !== req.user.id && !canAccessLocation(req.user, s.location_id)) fail(403, "You can only view shifts in your own branch");
  res.json({ ...shape(s), summary: await shiftSummary({ query }, s) });
});

module.exports = { router, shiftSummary };
