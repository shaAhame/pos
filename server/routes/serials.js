// Warranty lookup: find a unit by serial / IMEI, or a receipt by invoice number or customer phone.
const router = require("express").Router();
const { query } = require("../lib/db");
const { Joi, validate, text } = require("../lib/validate");
const { getSettings } = require("../lib/settings");

const todayIn = (tz) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

router.get("/lookup", validate(Joi.object({ q: text(80).min(2).required() }), "query"), async (req, res) => {
  const q = req.validQuery.q.trim();
  const { timezone } = await getSettings(req.biz);
  const today = todayIn(timezone);

  const { rows: units } = await query(
    `select s.*, p.name as product_name, p.variant, l.name as location_name,
            sa.invoice_number, sa.date as sale_date, sa.customer_name, c.contact_number as customer_phone, sl.name as sold_at_branch
       from serials s join products p on p.id = s.product_id
       left join locations l on l.id = s.location_id
       left join sales sa on sa.id = s.sale_id
       left join customers c on c.id = sa.customer_id
       left join locations sl on sl.id = sa.location_id
      where s.business_id = $1 and upper(s.serial) = upper($2)`,
    [req.biz, q]
  );
  const results = [];
  for (const u of units) {
    const { rows: events } = await query(
      `select e.event, e.ref_number, e.note, e.created_at, l.name as location_name, us.first_name || ' ' || us.last_name as user_name
         from serial_events e left join locations l on l.id = e.location_id left join users us on us.id = e.user_id
        where e.serial_id = $1 order by e.created_at`, [u.id]);
    const { rows: jobs } = await query(
      "select id, job_number, status, issue, created_at from repair_jobs where business_id = $1 and (serial_id = $2 or upper(serial) = upper($3)) order by created_at desc",
      [req.biz, u.id, u.serial]);
    results.push({
      kind: "unit", serial: u.serial, status: u.status, product: u.variant ? `${u.product_name} ${u.variant}` : u.product_name,
      location: u.location_name, invoiceNumber: u.invoice_number, soldAt: u.sale_date, soldAtBranch: u.sold_at_branch,
      customerName: u.customer_name, customerPhone: u.customer_phone, warrantyUntil: u.warranty_until,
      underWarranty: !!u.warranty_until && u.warranty_until >= today,
      events: events.map((e) => ({ event: e.event, ref: e.ref_number, note: e.note, at: e.created_at, location: e.location_name, by: e.user_name })),
      repairs: jobs.map((j) => ({ _id: j.id, jobNumber: j.job_number, status: j.status, issue: j.issue, createdAt: j.created_at })),
    });
  }
  if (!results.length) {
    // receipts by invoice number or customer phone (items that have a warranty)
    const { rows } = await query(
      `select sa.id, sa.invoice_number, sa.date, sa.customer_name, c.contact_number, i.name, i.quantity, i.warranty_until, lo.name as branch,
              (select string_agg(z.serial, ', ') from sale_item_serials z where z.sale_item_id = i.id) as serials
         from sales sa join sale_items i on i.sale_id = sa.id
         left join customers c on c.id = sa.customer_id left join locations lo on lo.id = sa.location_id
        where sa.business_id = $1 and sa.payment_status = 'Paid' and i.warranty_until is not null
          and (upper(sa.invoice_number) = upper($2) or regexp_replace(c.contact_number, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g'))
        order by sa.date desc limit 50`,
      [req.biz, q]
    );
    for (const r of rows) {
      const wu = r.warranty_until;
      results.push({ kind: "item", product: r.name, quantity: r.quantity, serials: r.serials, invoiceNumber: r.invoice_number, soldAt: r.date,
        soldAtBranch: r.branch, customerName: r.customer_name, customerPhone: r.contact_number, warrantyUntil: wu, underWarranty: wu >= today });
    }
  }
  res.json(results);
});

module.exports = router;
