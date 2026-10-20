// Reports for managers/owners. All dates are days in the shop's timezone (Settings).
const router = require("express").Router();
const { query } = require("../lib/db");
const { round2, toApi } = require("../lib/util");
const { Joi, validate, day } = require("../lib/validate");
const { getSettings } = require("../lib/settings");
const { dayRange } = require("../lib/dates");

const today = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()); // YYYY-MM-DD

const rangeQuery = Joi.object({ from: day, to: day, limit: Joi.number().integer().min(1).max(100).default(10) });

const resolveRange = async (q) => {
  const { timezone } = await getSettings();
  const to = q.to || today(timezone);
  const from = q.from || to;
  if (from > to) return { error: "'from' must be on or before 'to'" };
  return { from, to, tz: timezone };
};

router.get("/summary", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolveRange(req.validQuery);
  if (r.error) return res.status(400).json({ message: r.error });
  const sr = dayRange("s.date", r.from, r.to, r.tz, 1);
  const { rows: [s] } = await query(
    `select count(*) filter (where payment_status = 'Paid')::int as sales_count,
            coalesce(sum(total_amount) filter (where payment_status = 'Paid'), 0) as gross_sales,
            coalesce(sum(discount_amount) filter (where payment_status = 'Paid'), 0) as discounts,
            coalesce(sum(tax_amount) filter (where payment_status = 'Paid'), 0) as tax,
            coalesce(sum(total_amount) filter (where payment_status = 'Paid' and payment_method = 'Cash'), 0) as cash_sales,
            coalesce(sum(total_amount) filter (where payment_status = 'Paid' and payment_method = 'Card'), 0) as card_sales,
            count(*) filter (where payment_status = 'Voided')::int as void_count,
            coalesce(sum(total_amount) filter (where payment_status = 'Voided'), 0) as void_total,
            count(*) filter (where offline and offline_note is not null)::int as offline_review_count
       from sales s where ${sr.sql}`,
    sr.params
  );
  const rr = dayRange("r.created_at", r.from, r.to, r.tz, 1);
  const { rows: [ret] } = await query(
    `select count(*)::int as return_count, coalesce(sum(refund_amount), 0) as refunds from returns r where ${rr.sql}`,
    rr.params
  );
  // Profit: revenue net of discount (before tax) minus cost, for items that have a cost price.
  const { rows: [p] } = await query(
    `select coalesce(sum((i.quantity - i.returned_quantity) * i.price * (1 - s.discount / 100)), 0) as net_revenue,
            coalesce(sum((i.quantity - i.returned_quantity) * i.cost_price), 0) as cost,
            coalesce(sum(i.quantity - i.returned_quantity), 0)::int as items_sold,
            count(*) filter (where i.cost_price is null)::int as lines_without_cost
       from sale_items i join sales s on s.id = i.sale_id
      where s.payment_status = 'Paid' and ${sr.sql}`,
    sr.params
  );
  const { rows: [costed] } = await query(
    `select coalesce(sum((i.quantity - i.returned_quantity) * i.price * (1 - s.discount / 100)), 0) as revenue
       from sale_items i join sales s on s.id = i.sale_id
      where s.payment_status = 'Paid' and i.cost_price is not null and ${sr.sql}`,
    sr.params
  );
  res.json({
    from: r.from, to: r.to,
    salesCount: s.sales_count,
    grossSales: s.gross_sales,
    refunds: ret.refunds,
    netSales: round2(s.gross_sales - ret.refunds),
    averageSale: s.sales_count ? round2(s.gross_sales / s.sales_count) : 0,
    discounts: s.discounts,
    tax: s.tax,
    cashSales: s.cash_sales,
    cardSales: s.card_sales,
    voidCount: s.void_count,
    voidTotal: s.void_total,
    returnCount: ret.return_count,
    itemsSold: p.items_sold,
    grossProfit: round2(costed.revenue - p.cost),
    profitCoverage: p.lines_without_cost === 0 ? "full" : "partial", // partial = some items have no cost price
    offlineReviewCount: s.offline_review_count,
  });
});

// One row per day (for the chart).
router.get("/daily", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolveRange(req.validQuery);
  if (r.error) return res.status(400).json({ message: r.error });
  const { rows } = await query(
    `with days as (
       select generate_series($1::date, $2::date, interval '1 day')::date as day
     ),
     s as (
       select (date at time zone $3)::date as day, count(*)::int as n, sum(total_amount) as total
         from sales where payment_status = 'Paid'
          and date >= ($1::date)::timestamp at time zone $3 and date < ($2::date + 1)::timestamp at time zone $3
        group by 1
     ),
     r as (
       select (created_at at time zone $3)::date as day, sum(refund_amount) as refunds
         from returns
        where created_at >= ($1::date)::timestamp at time zone $3 and created_at < ($2::date + 1)::timestamp at time zone $3
        group by 1
     )
     select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(s.n, 0) as sales_count,
            coalesce(s.total, 0) as gross_sales, coalesce(r.refunds, 0) as refunds,
            coalesce(s.total, 0) - coalesce(r.refunds, 0) as net_sales
       from days d left join s on s.day = d.day left join r on r.day = d.day
      order by d.day`,
    [r.from, r.to, r.tz]
  );
  if (rows.length > 400) return res.status(400).json({ message: "Pick a range of 400 days or less" });
  res.json(rows.map((x) => toApi(x)));
});

router.get("/top-products", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolveRange(req.validQuery);
  if (r.error) return res.status(400).json({ message: r.error });
  const sr = dayRange("s.date", r.from, r.to, r.tz, 1);
  const { rows } = await query(
    `select coalesce(i.product_id::text, i.name) as key, max(i.name) as name, i.product_id,
            sum(i.quantity - i.returned_quantity)::int as quantity,
            sum((i.quantity - i.returned_quantity) * i.price) as revenue
       from sale_items i join sales s on s.id = i.sale_id
      where s.payment_status = 'Paid' and ${sr.sql}
      group by 1, i.product_id
     having sum(i.quantity - i.returned_quantity) > 0
      order by revenue desc
      limit ${req.validQuery.limit}`,
    sr.params
  );
  res.json(rows.map((x) => ({ productId: x.product_id, name: x.name, quantity: x.quantity, revenue: round2(x.revenue) })));
});

router.get("/low-stock", async (req, res) => {
  const { rows } = await query(
    `select * from products where active and quantity <= low_stock_threshold order by quantity, name limit 200`
  );
  res.json(rows.map((x) => toApi(x)));
});

// CSV export of sales (one row per sale), for Excel / accountant.
router.get("/sales.csv", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolveRange(req.validQuery);
  if (r.error) return res.status(400).json({ message: r.error });
  const sr = dayRange("s.date", r.from, r.to, r.tz, 1);
  const { rows } = await query(
    `select s.invoice_number, to_char(s.date at time zone $${sr.next}, 'YYYY-MM-DD HH24:MI') as local_time,
            s.customer_name, s.payment_method, s.payment_status, s.subtotal, s.discount_amount, s.tax_amount, s.total_amount,
            (select coalesce(sum(refund_amount),0) from returns r where r.sale_id = s.id) as refunded,
            coalesce(u.first_name || ' ' || u.last_name, '') as cashier, s.offline,
            (select string_agg(i.name || ' x' || i.quantity, '; ' order by i.name) from sale_items i where i.sale_id = s.id) as items
       from sales s left join users u on u.id = s.cashier_id
      where ${sr.sql} order by s.date`,
    [...sr.params, r.tz]
  );
  const esc = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // stop Excel formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Invoice", "Date", "Customer", "Payment", "Status", "Subtotal", "Discount", "Tax", "Total", "Refunded", "Cashier", "Offline", "Items"];
  const lines = rows.map((x) => [x.invoice_number, x.local_time, x.customer_name, x.payment_method, x.payment_status,
    x.subtotal, x.discount_amount, x.tax_amount, x.total_amount, x.refunded, x.cashier, x.offline ? "yes" : "", x.items].map(esc).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sales_${r.from}_to_${r.to}.csv"`);
  res.send("﻿" + [header.join(","), ...lines].join("\r\n"));
});

module.exports = router;
