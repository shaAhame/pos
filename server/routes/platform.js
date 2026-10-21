// MacQuad platform admin: create and manage client businesses.
const router = require("express").Router();
const bcrypt = require("bcrypt");
const { query, tx } = require("../lib/db");
const { Joi, validate, id, text } = require("../lib/validate");
const { requirePlatform, signPlatformToken } = require("../middleware/auth");
const { fail } = require("../lib/errors");
const { FEATURES, PRESETS, effectiveFeatures } = require("../lib/features");
const { clearSettingsCache } = require("../lib/settings");
const { strongPassword, SALT, loginLimiter } = require("./auth");

const featuresSchema = Joi.object(Object.fromEntries(Object.keys(FEATURES).map((k) => [k, Joi.boolean()])));
const type = Joi.string().valid("grocery", "electronics", "general");

// First-time setup of the platform: create the first MacQuad admin (only while there is none).
router.post(
  "/setup",
  loginLimiter,
  validate(Joi.object({ name: text(80).required(), email: Joi.string().trim().email().required(), password: strongPassword.required() })),
  async (req, res) => {
    const admin = await tx(async (db) => {
      await db.query("lock table platform_users in exclusive mode");
      const { rows } = await db.query("select exists(select 1 from platform_users) as any");
      if (rows[0].any) fail(409, "The platform is already set up. Please log in.");
      const { rows: [a] } = await db.query(
        "insert into platform_users (name, email, password) values ($1,$2,$3) returning id, name, email",
        [req.body.name, req.body.email, await bcrypt.hash(req.body.password, SALT())]
      );
      return a;
    });
    res.status(201).json({ token: signPlatformToken(admin), admin });
  }
);

router.post(
  "/login",
  loginLimiter,
  validate(Joi.object({ email: Joi.string().trim().email().required(), password: Joi.string().required() })),
  async (req, res) => {
    const { rows } = await query("select * from platform_users where lower(email) = lower($1)", [req.body.email]);
    const a = rows[0];
    if (!a || !a.active || !(await bcrypt.compare(req.body.password, a.password))) fail(401, "Invalid email or password");
    res.json({ token: signPlatformToken(a), admin: { id: a.id, name: a.name, email: a.email } });
  }
);

router.use(requirePlatform);

router.get("/me", (req, res) => res.json(req.admin));

router.get("/features", (req, res) => res.json({ features: FEATURES, presets: PRESETS }));

const BIZ_SELECT = `
  select b.*,
         (select count(*)::int from users u where u.business_id = b.id and u.active) as user_count,
         (select count(*)::int from locations l where l.business_id = b.id and l.active) as branch_count,
         (select count(*)::int from sales s where s.business_id = b.id and s.date > now() - interval '30 days' and s.payment_status = 'Paid') as sales_30d,
         (select coalesce(sum(total_amount), 0) from sales s where s.business_id = b.id and s.date > now() - interval '30 days' and s.payment_status = 'Paid') as revenue_30d,
         (select max(date) from sales s where s.business_id = b.id) as last_sale_at,
         (select json_agg(json_build_object('_id', u.id, 'name', u.first_name || ' ' || u.last_name, 'email', u.email, 'active', u.active) order by u.created_at)
            from users u where u.business_id = b.id and u.role = 'owner') as owners
    from businesses b`;
const shape = (b) => ({
  _id: b.id, name: b.name, type: b.type, status: b.status, plan: b.plan, notes: b.notes,
  contactName: b.contact_name, contactPhone: b.contact_phone, contactEmail: b.contact_email, createdAt: b.created_at,
  features: effectiveFeatures(b.type, b.features), userCount: b.user_count, branchCount: b.branch_count,
  sales30d: b.sales_30d, revenue30d: b.revenue_30d, lastSaleAt: b.last_sale_at, owners: b.owners || [],
});

router.get("/businesses", async (req, res) => {
  const { rows } = await query(`${BIZ_SELECT} order by b.status, b.created_at desc`);
  res.json(rows.map(shape));
});

router.get("/businesses/:id", validate(Joi.object({ id: id.required() }), "params"), async (req, res) => {
  const { rows } = await query(`${BIZ_SELECT} where b.id = $1`, [req.params.id]);
  if (!rows[0]) fail(404, "Business not found");
  res.json(shape(rows[0]));
});

// Create a client business with its owner login, settings and first branch.
router.post(
  "/businesses",
  validate(Joi.object({
    name: text(120).min(1).required(),
    type: type.default("grocery"),
    plan: text(40).default("standard"),
    features: featuresSchema,
    contactName: text(120).allow("").default(""), contactPhone: text(40).allow("").default(""),
    contactEmail: Joi.string().trim().email().allow("").default(""), notes: text(1000).allow("").default(""),
    branchName: text(80).default("Main store"),
    owner: Joi.object({
      firstName: text(60).required(), lastName: text(60).required(),
      email: Joi.string().trim().email().required(), password: strongPassword.required(),
    }).required(),
  })),
  async (req, res) => {
    const b = req.body;
    const bizId = await tx(async (db) => {
      const { rows: [biz] } = await db.query(
        `insert into businesses (name, type, plan, features, contact_name, contact_phone, contact_email, notes)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [b.name, b.type, b.plan, JSON.stringify(b.features || {}), b.contactName, b.contactPhone, b.contactEmail, b.notes]
      );
      await db.query("insert into settings (business_id, shop_name, phone, email) values ($1,$2,$3,$4)", [biz.id, b.name, b.contactPhone, b.contactEmail]);
      const { rows: [loc] } = await db.query("insert into locations (business_id, name, type) values ($1,$2,'store') returning id", [biz.id, b.branchName]);
      await db.query(
        "insert into users (business_id, first_name, last_name, email, password, role, location_id) values ($1,$2,$3,$4,$5,'owner',$6)",
        [biz.id, b.owner.firstName, b.owner.lastName, b.owner.email, await bcrypt.hash(b.owner.password, SALT()), loc.id]
      );
      return biz.id;
    });
    const { rows } = await query(`${BIZ_SELECT} where b.id = $1`, [bizId]);
    res.status(201).json(shape(rows[0]));
  }
);

router.put(
  "/businesses/:id",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    name: text(120).min(1), type, status: Joi.string().valid("active", "suspended"), plan: text(40),
    features: featuresSchema, contactName: text(120).allow(""), contactPhone: text(40).allow(""),
    contactEmail: Joi.string().trim().email().allow(""), notes: text(1000).allow(""),
  }).min(1)),
  async (req, res) => {
    const b = req.body;
    const map = { name: "name", type: "type", status: "status", plan: "plan", contactName: "contact_name", contactPhone: "contact_phone", contactEmail: "contact_email", notes: "notes" };
    const sets = [], vals = [req.params.id];
    for (const [k, col] of Object.entries(map)) if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${col} = $${vals.length}`); }
    if (b.features) {
      // store the full effective set, so later changes to a type's defaults don't silently change this client
      const { rows } = await query("select type, features from businesses where id = $1", [req.params.id]);
      if (!rows[0]) fail(404, "Business not found");
      const merged = { ...effectiveFeatures(b.type || rows[0].type, rows[0].features), ...b.features };
      vals.push(JSON.stringify(merged)); sets.push(`features = $${vals.length}`);
    }
    const { rowCount } = await query(`update businesses set ${sets.join(", ")} where id = $1`, vals);
    if (!rowCount) fail(404, "Business not found");
    clearSettingsCache(req.params.id);
    const { rows } = await query(`${BIZ_SELECT} where b.id = $1`, [req.params.id]);
    res.json(shape(rows[0]));
  }
);

// Reset a client's owner password (e.g. the owner forgot it).
router.post(
  "/businesses/:id/reset-password",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({ userId: id.required(), password: strongPassword.required() })),
  async (req, res) => {
    const { rowCount } = await query(
      "update users set password = $3, active = true where id = $1 and business_id = $2 and role = 'owner'",
      [req.body.userId, req.params.id, await bcrypt.hash(req.body.password, SALT())]
    );
    if (!rowCount) fail(404, "Owner not found in this business");
    res.json({ message: "Password reset" });
  }
);

// Other MacQuad admins
router.get("/admins", async (req, res) => {
  const { rows } = await query("select id as _id, name, email, active, created_at from platform_users order by created_at");
  res.json(rows);
});
router.post(
  "/admins",
  validate(Joi.object({ name: text(80).required(), email: Joi.string().trim().email().required(), password: strongPassword.required() })),
  async (req, res) => {
    const { rows } = await query(
      "insert into platform_users (name, email, password) values ($1,$2,$3) returning id as _id, name, email, active",
      [req.body.name, req.body.email, await bcrypt.hash(req.body.password, SALT())]
    );
    res.status(201).json(rows[0]);
  }
);

module.exports = router;
