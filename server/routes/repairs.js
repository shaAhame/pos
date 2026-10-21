// Repairs: job cards from booking-in to collection.
const router = require("express").Router();
const { query, tx } = require("../lib/db");
const { toApi, round2 } = require("../lib/util");
const { Joi, validate, id, money, text, day } = require("../lib/validate");
const { fail } = require("../lib/errors");
const { requireOneLocation, canAccessLocation } = require("../lib/location");
const { getSettings } = require("../lib/settings");
const { nextNumber } = require("../lib/counters");
const { takeStock, moveStock } = require("../lib/stock");
const { likeParam } = require("../lib/crud");
const { createSale } = require("../lib/saleService");
const serialsLib = require("../lib/serials");

const STATUSES = ["received", "diagnosing", "waiting_parts", "in_progress", "ready", "collected", "cancelled"];
const OPEN = ["received", "diagnosing", "waiting_parts", "in_progress", "ready"];

const SELECT = `
  select j.*, l.name as location_name, t.first_name || ' ' || t.last_name as technician_name,
         cb.first_name || ' ' || cb.last_name as created_by_name, sa.invoice_number,
         (select coalesce(sum(quantity * price), 0) from repair_parts p where p.job_id = j.id) as parts_total
    from repair_jobs j
    join locations l on l.id = j.location_id
    left join users t on t.id = j.technician_id
    left join users cb on cb.id = j.created_by
    left join sales sa on sa.id = j.sale_id`;

const shape = (j) => ({
  ...toApi(j, ["business_id", "location_name", "technician_name", "created_by_name", "invoice_number", "parts_total"]),
  location: { _id: j.location_id, name: j.location_name },
  technician: j.technician_id ? { _id: j.technician_id, name: j.technician_name } : null,
  createdByName: j.created_by_name,
  invoiceNumber: j.invoice_number,
  partsTotal: round2(j.parts_total),
  totalDue: j.under_warranty ? 0 : round2(Number(j.labour_charge) + Number(j.parts_total)),
});

const loadJob = async (db, biz, jobId, { lock = false } = {}) => {
  const { rows } = await db.query(`${SELECT} where j.id = $1 and j.business_id = $2 ${lock ? "for update of j" : ""}`, [jobId, biz]);
  return rows[0];
};
const detail = async (biz, jobId) => {
  const j = await loadJob({ query }, biz, jobId);
  const { rows: events } = await query(
    `select e.status, e.note, e.created_at, u.first_name || ' ' || u.last_name as user_name
       from repair_events e left join users u on u.id = e.user_id where e.job_id = $1 order by e.created_at`, [jobId]);
  const { rows: parts } = await query(
    `select p.id, p.product_id, p.name, p.quantity, p.price, s.serial from repair_parts p left join serials s on s.id = p.serial_id
      where p.job_id = $1 order by p.created_at`, [jobId]);
  return { ...shape(j), events: events.map((e) => toApi(e)), parts: parts.map((p) => toApi(p)) };
};
const guard = (req, j) => {
  if (!j) fail(404, "Job not found");
  if (!canAccessLocation(req.user, j.location_id)) fail(403, "This job belongs to another branch");
};
const event = (db, biz, jobId, status, note, userId) =>
  db.query("insert into repair_events (business_id, job_id, status, note, user_id) values ($1,$2,$3,$4,$5)", [biz, jobId, status, note || null, userId]);

router.get(
  "/",
  validate(Joi.object({
    status: Joi.string().valid("open", "all", ...STATUSES).default("open"),
    q: Joi.string().trim().allow("").max(80).default(""),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(200).default(30),
  }), "query"),
  async (req, res) => {
    const q = req.validQuery;
    const where = ["j.business_id = $1"], params = [req.biz];
    const add = (fn, v) => { params.push(v); where.push(fn("$" + params.length)); };
    if (q.status === "open") where.push(`j.status in ('${OPEN.join("','")}')`);
    else if (q.status !== "all") add((p) => `j.status = ${p}`, q.status);
    if (q.q) add((p) => `(j.job_number ilike ${p} or j.customer_name ilike ${p} or j.customer_phone ilike ${p} or j.serial ilike ${p} or j.device ilike ${p})`, likeParam(q.q));
    const loc = req.user.role === "owner" ? req.location?.id : req.user.locationId;
    if (loc) add((p) => `j.location_id = ${p}`, loc);
    const w = "where " + where.join(" and ");
    const total = (await query(`select count(*)::int n from repair_jobs j ${w}`, params)).rows[0].n;
    const { rows } = await query(`${SELECT} ${w} order by (j.status = 'ready') desc, j.created_at desc limit ${q.limit} offset ${(q.page - 1) * q.limit}`, params);
    res.json({ total, totalPages: Math.ceil(total / q.limit), currentPage: q.page, jobs: rows.map(shape) });
  }
);

router.get("/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  guard(req, await loadJob({ query }, req.biz, req.params.id));
  res.json(await detail(req.biz, req.params.id));
});

// Book a device in.
router.post(
  "/",
  validate(Joi.object({
    customer: id.allow(null, "").empty(["", null]),
    customerName: text(120).min(1).required(),
    customerPhone: text(40).min(3).required(),
    device: text(160).min(1).required(),
    serial: text(64).allow(""),
    issue: text(1000).min(1).required(),
    accessories: text(300).allow("").default(""),
    condition: text(300).allow("").default(""),
    estimate: money.allow(null, "").empty(["", null]),
    promisedDate: day.allow(null, "").empty(["", null]),
    technicianId: id.allow(null, "").empty(["", null]),
  })),
  async (req, res) => {
    const b = req.body;
    const loc = await requireOneLocation(req, { storeOnly: true });
    const { timezone } = await getSettings(req.biz);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    const jobId = await tx(async (db) => {
      let serialId = null, underWarranty = false;
      if (b.serial) {
        const { rows } = await db.query("select * from serials where business_id = $1 and upper(serial) = upper($2)", [req.biz, b.serial.trim()]);
        if (rows[0]) {
          serialId = rows[0].id;
          const wu = rows[0].warranty_until;
          underWarranty = rows[0].status === "sold" && !!wu && wu >= today && req.business.features.warranty;
        }
      }
      if (b.customer) {
        const { rows } = await db.query("select id from customers where id = $1 and business_id = $2", [b.customer, req.biz]);
        if (!rows[0]) fail(400, "Customer not found");
      }
      if (b.technicianId) {
        const { rows } = await db.query("select id from users where id = $1 and business_id = $2 and active", [b.technicianId, req.biz]);
        if (!rows[0]) fail(400, "Technician not found");
      }
      const number = await nextNumber(db, req.biz, "job");
      const { rows: [j] } = await db.query(
        `insert into repair_jobs (business_id, job_number, location_id, customer_id, customer_name, customer_phone, device, serial, serial_id,
                                  issue, accessories, condition, estimate, under_warranty, promised_date, technician_id, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
        [req.biz, number, loc.id, b.customer || null, b.customerName, b.customerPhone, b.device, b.serial || null, serialId,
         b.issue, b.accessories, b.condition, b.estimate ?? null, underWarranty, b.promisedDate || null, b.technicianId || null, req.user.id]
      );
      await event(db, req.biz, j.id, "received", underWarranty ? "Booked in. Under warranty." : "Booked in", req.user.id);
      if (serialId) await serialsLib.logEvent(db, req.biz, serialId, "booked in for repair", { locationId: loc.id, ref: number, note: b.issue, userId: req.user.id });
      return j.id;
    });
    res.status(201).json(await detail(req.biz, jobId));
  }
);

// Update status / details / charges.
router.put(
  "/:id",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    status: Joi.string().valid(...OPEN),
    note: text(1000).allow(""),
    technicianId: id.allow(null, ""),
    labourCharge: money,
    estimate: money.allow(null, ""),
    promisedDate: day.allow(null, ""),
    underWarranty: Joi.boolean(),
    issue: text(1000).min(1),
  }).min(1)),
  async (req, res) => {
    const b = req.body;
    await tx(async (db) => {
      const j = await loadJob(db, req.biz, req.params.id, { lock: true });
      guard(req, j);
      if (!OPEN.includes(j.status)) fail(409, `This job is ${j.status}`);
      if (b.underWarranty !== undefined && req.user.role === "cashier") fail(403, "Only a manager can change warranty status");
      if (b.technicianId) {
        const { rows } = await db.query("select id from users where id = $1 and business_id = $2 and active", [b.technicianId, req.biz]);
        if (!rows[0]) fail(400, "Technician not found");
      }
      const map = { status: "status", technicianId: "technician_id", labourCharge: "labour_charge", estimate: "estimate", promisedDate: "promised_date", underWarranty: "under_warranty", issue: "issue" };
      const sets = ["updated_at = now()"], vals = [j.id];
      for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { vals.push(b[k] === "" ? null : b[k]); sets.push(`${col} = $${vals.length}`); }
      await db.query(`update repair_jobs set ${sets.join(", ")} where id = $1`, vals);
      if (b.status && b.status !== j.status || b.note) await event(db, req.biz, j.id, b.status && b.status !== j.status ? b.status : null, b.note, req.user.id);
    });
    res.json(await detail(req.biz, req.params.id));
  }
);

// Use a part from this branch's stock.
router.post(
  "/:id/parts",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ product: id.required(), quantity: Joi.number().integer().min(1).max(1000).default(1), price: money, serial: text(64).allow("") })),
  async (req, res) => {
    const b = req.body;
    await tx(async (db) => {
      const j = await loadJob(db, req.biz, req.params.id, { lock: true });
      guard(req, j);
      if (!OPEN.includes(j.status)) fail(409, `This job is ${j.status}`);
      const { rows: [p] } = await db.query("select * from products where id = $1 and business_id = $2", [b.product, req.biz]);
      if (!p) fail(404, "Product not found");
      const name = p.variant ? `${p.name} ${p.variant}` : p.name;
      let serialId = null;
      if (p.track_serials && req.business.features.serials) {
        if (!b.serial || b.quantity !== 1) fail(400, `Scan the serial number of the "${name}" used (one at a time)`);
        const [u] = await serialsLib.lockInStock(db, req.biz, p.id, j.location_id, [b.serial], name);
        serialId = u.id;
        await serialsLib.setStatus(db, req.biz, u.id, "written_off", { event: "used in repair", ref: j.job_number, userId: req.user.id });
      }
      await takeStock(db, { biz: req.biz, productId: p.id, locationId: j.location_id, quantity: b.quantity, reason: "repair_part", refId: j.id, note: j.job_number, userId: req.user.id }, name);
      await db.query(
        "insert into repair_parts (business_id, job_id, product_id, name, quantity, price, cost, serial_id, user_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [req.biz, j.id, p.id, name, b.quantity, b.price ?? p.price, p.cost_price, serialId, req.user.id]
      );
      await db.query("update repair_jobs set updated_at = now() where id = $1", [j.id]);
      await event(db, req.biz, j.id, null, `Part used: ${name} x${b.quantity}`, req.user.id);
    });
    res.status(201).json(await detail(req.biz, req.params.id));
  }
);

router.delete(
  "/:id/parts/:partId",
  validate(Joi.object({ id: id.required(), partId: id.required() }), "params"),
  async (req, res) => {
    await tx(async (db) => {
      const j = await loadJob(db, req.biz, req.params.id, { lock: true });
      guard(req, j);
      if (!OPEN.includes(j.status)) fail(409, `This job is ${j.status}`);
      const { rows: [part] } = await db.query("delete from repair_parts where id = $1 and job_id = $2 returning *", [req.params.partId, j.id]);
      if (!part) fail(404, "Part not found");
      await moveStock(db, { biz: req.biz, productId: part.product_id, locationId: j.location_id, change: part.quantity, reason: "repair_part_back", refId: j.id, note: j.job_number, userId: req.user.id });
      if (part.serial_id) await serialsLib.setStatus(db, req.biz, part.serial_id, "in_stock", { locationId: j.location_id, event: "part returned to stock", ref: j.job_number, userId: req.user.id });
      await event(db, req.biz, j.id, null, `Part removed: ${part.name} x${part.quantity}`, req.user.id);
    });
    res.json(await detail(req.biz, req.params.id));
  }
);

// Customer collects: take payment through the till (labour + parts), unless under warranty.
router.post(
  "/:id/collect",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    payments: Joi.array().max(5).items(Joi.object({ method: Joi.string().valid("Cash", "Card", "Bank").required(), amount: money.required() })).default([]),
    cashTendered: money.allow(null),
    clientRef: id,
  })),
  async (req, res) => {
    const settings = await getSettings(req.biz);
    await tx(async (db) => {
      const j = await loadJob(db, req.biz, req.params.id, { lock: true });
      guard(req, j);
      if (!OPEN.includes(j.status)) fail(409, `This job is ${j.status}`);
      const { rows: parts } = await db.query("select * from repair_parts where job_id = $1 order by created_at", [j.id]);
      let saleId = null;
      if (!j.under_warranty) {
        const serviceLines = [];
        if (Number(j.labour_charge) > 0) serviceLines.push({ name: `Repair ${j.job_number}: ${j.device}`, price: Number(j.labour_charge), quantity: 1 });
        for (const p of parts) serviceLines.push({ name: `Part: ${p.name} (${j.job_number})`, price: Number(p.price), quantity: p.quantity });
        if (serviceLines.length) {
          const r = await createSale(db, { biz: req.biz, user: req.user, features: req.business.features, settings, location: req.location }, {
            clientRef: req.body.clientRef, items: [], serviceLines, customer: j.customer_id, customerName: j.customer_name,
            payments: req.body.payments, cashTendered: req.body.cashTendered,
          });
          saleId = r.saleId;
        }
      }
      await db.query("update repair_jobs set status = 'collected', collected_at = now(), sale_id = $2, updated_at = now() where id = $1", [j.id, saleId]);
      await event(db, req.biz, j.id, "collected", j.under_warranty ? "Collected (warranty, no charge)" : "Collected and paid", req.user.id);
      if (j.serial_id) await serialsLib.logEvent(db, req.biz, j.serial_id, "repair collected", { locationId: j.location_id, ref: j.job_number, userId: req.user.id });
    });
    res.json(await detail(req.biz, req.params.id));
  }
);

router.post(
  "/:id/cancel",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ reason: text(300).min(1).required() })),
  async (req, res) => {
    await tx(async (db) => {
      const j = await loadJob(db, req.biz, req.params.id, { lock: true });
      guard(req, j);
      if (!OPEN.includes(j.status)) fail(409, `This job is ${j.status}`);
      const { rows: parts } = await db.query("delete from repair_parts where job_id = $1 returning *", [j.id]);
      for (const part of parts) {
        await moveStock(db, { biz: req.biz, productId: part.product_id, locationId: j.location_id, change: part.quantity, reason: "repair_part_back", refId: j.id, note: `${j.job_number} cancelled`, userId: req.user.id });
        if (part.serial_id) await serialsLib.setStatus(db, req.biz, part.serial_id, "in_stock", { locationId: j.location_id, event: "part returned to stock", ref: j.job_number, userId: req.user.id });
      }
      await db.query("update repair_jobs set status = 'cancelled', updated_at = now() where id = $1", [j.id]);
      await event(db, req.biz, j.id, "cancelled", req.body.reason, req.user.id);
    });
    res.json(await detail(req.biz, req.params.id));
  }
);

module.exports = router;
