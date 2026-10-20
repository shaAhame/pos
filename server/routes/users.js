// Staff accounts. Owner only.
const router = require("express").Router();
const bcrypt = require("bcrypt");
const { query, tx } = require("../lib/db");
const { Joi, validate, text, id } = require("../lib/validate");
const { fail } = require("../lib/errors");
const { strongPassword, SALT } = require("./auth");

const shape = (u) => ({
  _id: u.id, firstName: u.first_name, lastName: u.last_name, email: u.email,
  role: u.role, active: u.active, createdAt: u.created_at,
});
const role = Joi.string().valid("owner", "manager", "cashier");

router.get("/", async (req, res) => {
  const { rows } = await query("select * from users order by active desc, role, first_name");
  res.json(rows.map(shape));
});

router.post(
  "/",
  validate(Joi.object({
    firstName: text(60).required(), lastName: text(60).required(),
    email: Joi.string().trim().email().max(200).required(), password: strongPassword.required(),
    role: role.default("cashier"),
  })),
  async (req, res) => {
    const b = req.body;
    const { rows } = await query(
      "insert into users (first_name, last_name, email, password, role) values ($1,$2,$3,$4,$5) returning *",
      [b.firstName, b.lastName, b.email, await bcrypt.hash(b.password, SALT()), b.role]
    );
    res.status(201).json(shape(rows[0]));
  }
);

// Update name/email/role/active, or reset password.
router.put(
  "/:id",
  validate(Joi.object({ id: id.required() }), "params"),
  validate(Joi.object({
    firstName: text(60), lastName: text(60), email: Joi.string().trim().email().max(200),
    role, active: Joi.boolean(), password: strongPassword,
  }).min(1)),
  async (req, res) => {
    const b = req.body;
    const user = await tx(async (db) => {
      // Lock all owners so two requests can't remove the last owner at the same time.
      await db.query("select id from users where role = 'owner' and active for update");
      const { rows: cur } = await db.query("select * from users where id = $1 for update", [req.params.id]);
      if (!cur[0]) fail(404, "User not found");
      const losingOwner = cur[0].role === "owner" && cur[0].active && ((b.role && b.role !== "owner") || b.active === false);
      if (losingOwner) {
        const { rows } = await db.query("select count(*)::int n from users where role = 'owner' and active");
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
      const { rows } = await db.query(`update users set ${sets.join(", ")} where id = $1 returning *`, vals);
      return rows[0];
    });
    res.json(shape(user));
  }
);

module.exports = router;
