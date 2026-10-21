// Reports for managers/owners. Dates are days in the business's timezone (Settings).
const router = require("express").Router();
const { query } = require("../lib/db");
const { round2, toApi } = require("../lib/util");
const { Joi, validate, day, id } = require("../lib/validate");
const { getSettings } = require("../lib/settings");
const { canAccessLocation } = require("../lib/location");
const { fail } = require("../lib/errors");

const today = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

// managers -> their branch; owner -> ?locationId, the chosen branch, or all (null)
const scope = (req, q) => {
  if (req.user.role !== "owner") return req.user.locationId;
  if (q.locationId) { if (!canAccessLocation(req.user, q.locationId)) fail(403, "Not allowed"); return q.locationId; }
  return req.location?.id || null;
};

const rangeQuery = Joi.object({ from: day, to: day, limit: Joi.number().integer().min(1).max(100).default(10), locationId: id });

// Common parameters: $1 business, $2 from, $3 to, $4 timezone, $5 location (nullable)
const resolve = async (req) => {
  const q = req.validQuery;
  const { timezone } = await getSettings(req.biz);
  const to = q.to || today(timezone);
  const from = q.from || to;
  if (from > to) fail(400, "'from' must be on or before 'to'");
  return { from, to, tz: timezone, loc: scope(req, q), params: [req.biz, from, to, timezone, scope(req, q)] };
};
const inRange = (col) => `${col} >= ($2::date)::timestamp at time zone $4 and ${col} < ($3::date + 1)::timestamp at time zone $4`;
const atLoc = (col) => `($5::uuid is null or ${col} = $5::uuid)`;

router.get("/summary", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolve(req);
  const { rows: [s] } = await query(
    `select count(*) filter (where payment_status = 'Paid')::int as sales_count,
            coalesce(sum(total_amount) filter (where payment_status = 'Paid'), 0) as gross_sales,
            coalesce(sum(discount_amount) filter (where payment_status = 'Paid'), 0) as discounts,
            coalesce(sum(tax_amount) filter (where payment_status = 'Paid'), 0) as tax,
            count(*) filter (where payment_status = 'Voided')::int as void_count,
            coalesce(sum(total_amount) filter (where payment_status = 'Voided'), 0) as void_total,
            count(*) filter (where offline and offline_note is not null)::int as offline_review_count
       from sales s where s.business_id = $1 and ${inRange("s.date")} and ${atLoc("s.location_id")}`,
    r.params
  );
  const { rows: pm } = await query(
    `select method, coalesce(sum(amount), 0) as amount from payments p
      where p.business_id = $1 and p.kind in ('sale','void') and ${inRange("p.created_at")} and ${atLoc("p.location_id")}
      group by method`,
    r.params
  );
  const byMethod = Object.fromEntries(pm.map((x) => [x.method, round2(x.amount)]));
  const { rows: [col] } = await query(
    `select coalesce(sum(amount) filter (where kind = 'installment'), 0) as installments,
            coalesce(sum(amount) filter (where kind in ('deposit','deposit_refund')), 0) as deposits
       from payments p where p.business_id = $1 and ${inRange("p.created_at")} and ${atLoc("p.location_id")}`,
    r.params
  );
  const { rows: [ret] } = await query(
    `select count(*)::int as return_count, coalesce(sum(refund_amount), 0) as refunds from returns rt
      where rt.business_id = $1 and ${inRange("rt.created_at")} and ${atLoc("rt.location_id")}`,
    r.params
  );
  const { rows: [p] } = await query(
    `select coalesce(sum((i.quantity - i.returned_quantity) * (i.total / i.quantity) * (1 - s.discount / 100)), 0) as net_revenue,
            coalesce(sum((i.quantity - i.returned_quantity) * (i.total / i.quantity) * (1 - s.discount / 100)) filter (where i.cost_price is not null), 0) as costed_revenue,
            coalesce(sum((i.quantity - i.returned_quantity) * i.cost_price), 0) as cost,
            coalesce(sum(i.quantity - i.returned_quantity), 0)::int as items_sold,
            count(*) filter (where i.cost_price is null and i.product_id is not null)::int as lines_without_cost
       from sale_items i join sales s on s.id = i.sale_id
      where s.business_id = $1 and s.payment_status = 'Paid' and ${inRange("s.date")} and ${atLoc("s.location_id")}`,
    r.params
  );
  res.json({
    from: r.from, to: r.to, locationId: r.loc,
    salesCount: s.sales_count,
    grossSales: s.gross_sales,
    refunds: ret.refunds,
    netSales: round2(s.gross_sales - ret.refunds),
    averageSale: s.sales_count ? round2(s.gross_sales / s.sales_count) : 0,
    discounts: s.discounts,
    tax: s.tax,
    cashSales: byMethod.Cash || 0,
    cardSales: byMethod.Card || 0,
    bankSales: byMethod.Bank || 0,
    tradeInValue: byMethod.TradeIn || 0,
    creditSales: byMethod.Credit || 0,
    depositsUsed: byMethod.Deposit || 0,
    installmentsCollected: round2(col.installments),
    depositsTaken: round2(col.deposits),
    voidCount: s.void_count,
    voidTotal: s.void_total,
    returnCount: ret.return_count,
    itemsSold: p.items_sold,
    grossProfit: round2(p.costed_revenue - p.cost),
    profitCoverage: p.lines_without_cost === 0 ? "full" : "partial",
    offlineReviewCount: s.offline_review_count,
  });
});

router.get("/daily", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolve(req);
  const { rows } = await query(
    `with days as (select generate_series($2::date, $3::date, interval '1 day')::date as day),
     s as (select (date at time zone $4)::date as day, count(*)::int as n, sum(total_amount) as total
             from sales s where s.business_id = $1 and payment_status = 'Paid' and ${inRange("s.date")} and ${atLoc("s.location_id")} group by 1),
     rt as (select (created_at at time zone $4)::date as day, sum(refund_amount) as refunds
             from returns rt where rt.business_id = $1 and ${inRange("rt.created_at")} and ${atLoc("rt.location_id")} group by 1)
     select to_char(d.day, 'YYYY-MM-DD') as day, coalesce(s.n, 0) as sales_count,
            coalesce(s.total, 0) as gross_sales, coalesce(rt.refunds, 0) as refunds,
            coalesce(s.total, 0) - coalesce(rt.refunds, 0) as net_sales
       from days d left join s on s.day = d.day left join rt on rt.day = d.day order by d.day`,
    r.params
  );
  if (rows.length > 400) fail(400, "Pick a range of 400 days or less");
  res.json(rows.map((x) => toApi(x)));
});

router.get("/top-products", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolve(req);
  const { rows } = await query(
    `select coalesce(i.product_id::text, i.name) as key, max(i.name) as name, i.product_id,
            sum(i.quantity - i.returned_quantity)::int as quantity,
            sum((i.quantity - i.returned_quantity) * (i.total / i.quantity)) as revenue
       from sale_items i join sales s on s.id = i.sale_id
      where s.business_id = $1 and s.payment_status = 'Paid' and ${inRange("s.date")} and ${atLoc("s.location_id")}
      group by 1, i.product_id having sum(i.quantity - i.returned_quantity) > 0
      order by revenue desc limit ${req.validQuery.limit}`,
    r.params
  );
  res.json(rows.map((x) => ({ productId: x.product_id, name: x.name, quantity: x.quantity, revenue: round2(x.revenue) })));
});

router.get("/low-stock", validate(Joi.object({ locationId: id }), "query"), async (req, res) => {
  const loc = scope(req, req.validQuery);
  const { rows } = await query(
    `select p.id, p.name, p.variant, p.category, p.low_stock_threshold, ps.quantity, l.id as location_id, l.name as location_name
       from product_stock ps join products p on p.id = ps.product_id join locations l on l.id = ps.location_id
      where ps.business_id = $1 and p.active and l.active and ps.quantity <= p.low_stock_threshold and ($2::uuid is null or l.id = $2::uuid)
      order by ps.quantity, p.name, l.name limit 300`,
    [req.biz, loc]
  );
  res.json(rows.map((x) => toApi(x)));
});

router.get("/by-location", validate(rangeQuery, "query"), async (req, res) => {
  if (req.user.role !== "owner") fail(403, "Only the owner can compare branches");
  const r = await resolve(req);
  const { rows } = await query(
    `select l.id, l.name, l.type,
            coalesce(s.n, 0)::int as sales_count, coalesce(s.total, 0) as gross_sales,
            coalesce(rt.refunds, 0) as refunds, coalesce(s.total, 0) - coalesce(rt.refunds, 0) as net_sales,
            (select coalesce(sum(ps.quantity * coalesce(p.cost_price, 0)), 0) from product_stock ps join products p on p.id = ps.product_id
              where ps.location_id = l.id and p.active) as stock_value_at_cost
       from locations l
       left join (select location_id, count(*) as n, sum(total_amount) as total from sales s
                   where s.business_id = $1 and s.payment_status = 'Paid' and ${inRange("s.date")} group by location_id) s on s.location_id = l.id
       left join (select location_id, sum(refund_amount) as refunds from returns rt
                   where rt.business_id = $1 and ${inRange("rt.created_at")} group by location_id) rt on rt.location_id = l.id
      where l.business_id = $1 and l.active and ($5::uuid is null or true)
      order by l.type desc, net_sales desc`,
    r.params
  );
  res.json(rows.map((x) => toApi(x)));
});

router.get("/sales.csv", validate(rangeQuery, "query"), async (req, res) => {
  const r = await resolve(req);
  const { rows } = await query(
    `select s.invoice_number, to_char(s.date at time zone $4, 'YYYY-MM-DD HH24:MI') as local_time, coalesce(lo.name, '') as branch,
            s.customer_name, s.payment_method, s.payment_status, s.subtotal, s.discount_amount, s.tax_amount, s.total_amount,
            (select coalesce(sum(refund_amount),0) from returns r where r.sale_id = s.id) as refunded,
            coalesce(u.first_name || ' ' || u.last_name, '') as cashier, s.offline,
            (select string_agg(i.name || ' x' || i.quantity, '; ' order by i.name) from sale_items i where i.sale_id = s.id) as items,
            (select string_agg(z.serial, ' ' order by z.serial) from sale_item_serials z join sale_items i on i.id = z.sale_item_id where i.sale_id = s.id) as serials
       from sales s left join users u on u.id = s.cashier_id left join locations lo on lo.id = s.location_id
      where s.business_id = $1 and ${inRange("s.date")} and ${atLoc("s.location_id")} order by s.date`,
    r.params
  );
  const esc = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Invoice", "Date", "Branch", "Customer", "Payment", "Status", "Subtotal", "Discount", "Tax", "Total", "Refunded", "Cashier", "Offline", "Items", "Serials"];
  const lines = rows.map((x) => [x.invoice_number, x.local_time, x.branch, x.customer_name, x.payment_method, x.payment_status,
    x.subtotal, x.discount_amount, x.tax_amount, x.total_amount, x.refunded, x.cashier, x.offline ? "yes" : "", x.items, x.serials].map(esc).join(","));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sales_${r.from}_to_${r.to}.csv"`);
  res.send("﻿" + [header.join(","), ...lines].join("\r\n"));
});

module.exports = router;
