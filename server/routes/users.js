// Staff logins. Owner only.
const router = require("express").Router();
const bcrypt = require("bcrypt");
const { query, tx } = require("../lib/db");
const { Joi, validate, text, id } = require("../lib/validate");
const { fail } = require("../lib/errors");
const { strongPassword, SALT } = require("./auth");

const shape = (u) => ({
  _id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email,
  role: u.role, active: u.active, createdAt: u.created_at, hasApprovalPin: !!u.approval_pin,
  location: u.location_id ? { _id: u.location_id, name: u.location_name } : null,
});
const SELECT = "select u.*, l.name as location_name from users u left join locations l on l.id = u.location_id";
const role = Joi.string().valid("owner", "manager", "cashier");

// Cashiers and managers must belong to a branch. With only one branch, it's picked automatically.
const resolveBranch = async (db, biz, role, locationId) => {
  if (role === "owner") return locationId || null;
  if (locationId) {
    const { rows } = await db.query("select id from locations where id = $1 and business_id = $2 and active", [locationId, biz]);
    if (!rows[0]) fail(400, "Branch not found or inactive");
    return locationId;
  }
  const { rows } = await db.query("select id from locations where business_id = $1 and active order by created_at limit 2", [biz]);
  if (rows.length === 1) return rows[0].id;
  fail(400, "Choose which branch this person works at");
};

router.get("/", async (req, res) => {
  const { rows } = await query(`${SELECT} where u.business_id = $1 order by u.active desc, u.role, u.first_name`, [req.biz]);
  res.json(rows.map(shape));
});

// Managers and owners (for the discount approval box at the till) - any logged-in user may list them.
router.get("/approvers", async (req, res) => {
  const { rows } = await query(
    `select id, first_name, last_name, role from users
      where business_id = $1 and active and approval_pin is not null and (role = 'owner' or (role = 'manager' and location_id = $2))
      order by role desc, first_name`,
    [req.biz, req.location?.id || null]
  );
  res.json(rows.map((u) => ({ _id: u.id, name: `${u.first_name} ${u.last_name}`, role: u.role })));
});

// Names of active staff (e.g. to pick a technician on a repair). Any logged-in user.
router.get("/staff", async (req, res) => {
  const { rows } = await query(
    "select id, first_name, last_name, role, location_id from users where business_id = $1 and active order by first_name",
    [req.biz]
  );
  res.json(rows.map((u) => ({ _id: u.id, name: `${u.first_name} ${u.last_name}`, role: u.role, locationId: u.location_id })));
});

router.post(
  "/",
  validate(Joi.object({
    firstName: text(60).required(), lastName: text(60).required(),
    email: Joi.string().trim().email().max(200).required(), password: strongPassword.required(),
    role: role.default("cashier"), locationId: id.allow(null, "").empty(["", null]),
  })),
  async (req, res) => {
    const b = req.body;
    const loc = await resolveBranch({ query }, req.biz, b.role, b.locationId);
    const { rows } = await query(
      "insert into users (business_id, first_name, last_name, email, password, role, location_id) values ($1,$2,$3,$4,$5,$6,$7) returning id",
      [req.biz, b.firstName, b.lastName, b.email, await bcrypt.hash(b.password, SALT()), b.role, loc]
    );
    res.status(201).json(shape((await query(`${SELECT} where u.id = $1`, [rows[0].id])).rows[0]));
  }
);

router.put(
  "/:id",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    firstName: text(60), lastName: text(60), email: Joi.string().trim().email().max(200),
    role, active: Joi.boolean(), password: strongPassword, locationId: id.allow(null, ""),
  }).min(1)),
  async (req, res) => {
    const b = req.body;
    const user = await tx(async (db) => {
      await db.query("select id from users where business_id = $1 and role = 'owner' and active for update", [req.biz]);
      const { rows: cur } = await db.query("select * from users where id = $1 and business_id = $2 for update", [req.params.id, req.biz]);
      if (!cur[0]) fail(404, "User not found");
      const losingOwner = cur[0].role === "owner" && cur[0].active && ((b.role && b.role !== "owner") || b.active === false);
      if (losingOwner) {
        const { rows } = await db.query("select count(*)::int n from users where business_id = $1 and role = 'owner' and active", [req.biz]);
        if (rows[0].n <= 1) fail(400, "There must always be at least one active owner");
      }
      const sets = [], vals = [req.params.id];
      const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (b.firstName !== undefined) add("first_name", b.firstName);
      if (b.lastName !== undefined) add("last_name", b.lastName);
      if (b.email !== undefined) add("email", b.email);
      if (b.role !== undefined) add("role", b.role);
      if (b.active !== undefined) add("active", b.active);
      if (b.password !== undefined) add("password", await bcrypt.hash(b.password, SALT()));
      if (b.role === "cashier") add("approval_pin", null);
      const newRole = b.role || cur[0].role;
      if (b.locationId !== undefined || (b.role && b.role !== "owner" && !cur[0].location_id)) {
        add("location_id", await resolveBranch(db, req.biz, newRole, b.locationId || (b.locationId === undefined ? cur[0].location_id : null)));
      }
      await db.query(`update users set ${sets.join(", ")} where id = $1`, vals);
      return (await db.query(`${SELECT} where u.id = $1`, [req.params.id])).rows[0];
    });
    res.json(shape(user));
  }
);

module.exports = router;
